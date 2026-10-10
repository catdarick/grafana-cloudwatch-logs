import { COMMANDS, FUNCTIONS, KEYWORDS } from './logsInsights';

/**
 * A mistake found in a query, positioned the way Monaco counts: lines and columns from 1, the end
 * column exclusive.
 *
 * An error is certain to fail the query. A warning is a likely cause, worth showing once the query
 * has failed but not before: the query may well be valid.
 */
export interface QueryProblem {
  severity: 'error' | 'warning';
  line: number;
  column: number;
  endColumn: number;
  message: string;
}

type TokenType = 'word' | 'number' | 'string' | 'regex' | 'pipe' | 'comma' | 'open' | 'close' | 'operator';

interface Token {
  type: TokenType;
  text: string;
  line: number;
  column: number;
  endColumn: number;
  /** Line the token ends on; differs from line only for a string that spans lines. */
  endLine: number;
  /** Whitespace or a comment right before the token. */
  spaced: boolean;
}

const COMMAND_NAMES = new Map(COMMANDS.map((c) => [c.toLowerCase(), c]));
const FUNCTION_NAMES = [...FUNCTIONS, ...KEYWORDS];
const KNOWN_FUNCTIONS = new Set(FUNCTION_NAMES.map((f) => f.toLowerCase()));
// Words that join two expressions, so two words in a row with one of these are not a missing comma.
const CONNECTORS = new Set(['as', 'by', 'and', 'or', 'not', 'like', 'in', 'asc', 'desc']);
// Commands that mean nothing without arguments. Others (estimate, unmask, pattern...) may stand alone.
const NEEDS_ARGUMENTS = new Set(['fields', 'display', 'filter', 'where', 'stats', 'sort', 'limit', 'parse', 'dedup']);
// Commands taking a plain comma-separated list of fields or expressions.
const LIST_COMMANDS = new Set(['fields', 'display', 'dedup']);
// After these a slash can only start a regex: a division needs something to divide.
const REGEX_AFTER_WORDS = new Set(['like', 'filter', 'where', 'parse']);
const COMPARISONS = new Set(['=', '!=', '<', '>', '<=', '>=', '=~']);
const FOREIGN_OPERATORS: Record<string, string> = { '==': '=', '&&': 'and', '||': 'or' };
const PAIRS: Record<string, string> = { ')': '(', ']': '[' };
const MAX_LIMIT = 100000;

/**
 * Checks a Logs Insights query against the documented syntax. Grafana 10.4 replaces CloudWatch's
 * own syntax errors with a generic message, so this is what the user gets instead.
 *
 * Errors are only what is certain to fail (or a command missing from the documentation): a false
 * alarm on a valid query is worse than a missed mistake. Anything less certain is a warning, such
 * as an unknown function. Stages inside brackets (subqueries) are not checked.
 */
export function lintQuery(query: string): QueryProblem[] {
  const { tokens, problems } = tokenize(query);
  problems.push(...checkBrackets(tokens));
  problems.push(...checkTokens(tokens));
  const stages = splitStages(tokens);
  stages.forEach((stage) => problems.push(...checkStage(stage)));
  problems.push(...checkStageOrder(stages));
  return problems.sort((a, b) => a.line - b.line || a.column - b.column);
}

function tokenize(query: string): { tokens: Token[]; problems: QueryProblem[] } {
  const tokens: Token[] = [];
  const problems: QueryProblem[] = [];
  const lineEnd = (i: number) => (query.indexOf('\n', i) < 0 ? query.length : query.indexOf('\n', i));
  let line = 1;
  let lineStart = 0;
  let spaced = true;

  const push = (type: TokenType, start: number, end: number, endLine = line) => {
    const text = query.slice(start, end);
    const column = start - lineStart + 1;
    tokens.push({ type, text, line, column, endColumn: column + text.length, endLine, spaced });
    spaced = false;
  };
  const error = (start: number, end: number, message: string) =>
    problems.push({ severity: 'error', line, column: start - lineStart + 1, endColumn: end - lineStart + 1, message });

  // Command of the current stage: in parse, a slash after the field starts the pattern.
  const command = () => {
    const pipe = tokens.map((t) => t.type).lastIndexOf('pipe');
    return tokens[pipe + 1]?.text.toLowerCase();
  };
  const regexAllowed = () => {
    const prev = tokens[tokens.length - 1];
    if (!prev || prev.type === 'pipe' || command() === 'parse') {
      return true;
    }
    if (prev.type === 'word') {
      return REGEX_AFTER_WORDS.has(prev.text.toLowerCase());
    }
    return prev.type === 'operator' || prev.type === 'open' || prev.type === 'comma';
  };

  let i = 0;
  while (i < query.length) {
    const ch = query[i];
    if (ch === '\n') {
      i++;
      line++;
      lineStart = i;
      spaced = true;
    } else if (/\s/.test(ch)) {
      i++;
      spaced = true;
    } else if (ch === '#') {
      i = lineEnd(i);
      spaced = true;
    } else if (ch === "'" || ch === '"') {
      // Strings may go on over several lines.
      const end = closingIndex(query, i, ch, true);
      if (end < 0) {
        error(i, lineEnd(i), `Unclosed string: ${ch} has no closing ${ch}`);
        push('string', i, lineEnd(i));
        i = lineEnd(i);
      } else {
        const newlines = query.slice(i, end).split('\n').length - 1;
        push('string', i, end + 1, line + newlines);
        if (newlines > 0) {
          line += newlines;
          lineStart = query.lastIndexOf('\n', end) + 1;
        }
        i = end + 1;
      }
    } else if (ch === '/' && regexAllowed()) {
      const end = closingIndex(query, i, '/', false);
      if (end < 0) {
        error(i, lineEnd(i), 'Unclosed regex: / has no closing / on this line');
        push('regex', i, lineEnd(i));
        i = lineEnd(i);
      } else {
        // Flags (/abc/i) belong to the regex.
        let stop = end + 1;
        while (stop < query.length && /[a-z]/i.test(query[stop])) {
          stop++;
        }
        push('regex', i, stop);
        i = stop;
      }
    } else if (/[@A-Za-z_$`]/.test(ch)) {
      // A field name, with `quoted parts` for special characters: @`aws.tag.x:y`, json.`user.id`.
      let j = i;
      while (j < query.length && /[\w.@$`]/.test(query[j])) {
        if (query[j] === '`') {
          const end = closingIndex(query, j, '`', false);
          if (end < 0) {
            error(j, lineEnd(j), 'Unclosed backtick: ` has no closing ` on this line');
            j = lineEnd(j);
            break;
          }
          j = end + 1;
        } else {
          j++;
        }
      }
      push('word', i, j);
      i = j;
    } else if (/\d/.test(ch)) {
      const j = i + /^\d[\w.]*/.exec(query.slice(i))![0].length;
      push('number', i, j);
      i = j;
    } else if (ch === '|') {
      // || is not an operator in Logs Insights, but reads as one rather than as two empty stages.
      const double = query[i + 1] === '|';
      push(double ? 'operator' : 'pipe', i, i + (double ? 2 : 1));
      i += double ? 2 : 1;
    } else {
      const type: TokenType | undefined =
        ch === ',' ? 'comma' : '(['.includes(ch) ? 'open' : ')]'.includes(ch) ? 'close' : undefined;
      const j = type ? i + 1 : i + (/^[=<>!~+\-*/%^:&]+/.exec(query.slice(i))?.[0].length ?? 1);
      push(type ?? 'operator', i, j);
      i = j;
    }
  }
  return { tokens, problems };
}

/**
 * Index of the character that closes the quote at `start`, skipping escaped characters and, in a
 * regex, character classes ([/] does not end it); -1 if none.
 */
function closingIndex(text: string, start: number, quote: string, multiline: boolean): number {
  let inClass = false;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n' && !multiline) {
      return -1;
    } else if (ch === '\\') {
      i++;
    } else if (quote === '/' && ch === '[') {
      inClass = true;
    } else if (inClass && ch === ']') {
      inClass = false;
    } else if (ch === quote && !inClass) {
      return i;
    }
  }
  return -1;
}

function checkBrackets(tokens: Token[]): QueryProblem[] {
  const problems: QueryProblem[] = [];
  const open: Token[] = [];
  for (const t of tokens) {
    if (t.type === 'open') {
      open.push(t);
    } else if (t.type === 'close') {
      if (open[open.length - 1]?.text === PAIRS[t.text]) {
        open.pop();
      } else {
        problems.push(error(t, `Unexpected ${t.text}: there is no ${PAIRS[t.text]} for it to close`));
      }
    }
  }
  open.forEach((t) => problems.push(error(t, `Unclosed ${t.text}`)));
  return problems;
}

/** Likely mistakes anywhere in the query, whatever the command. */
function checkTokens(tokens: Token[]): QueryProblem[] {
  const problems: QueryProblem[] = [];
  tokens.forEach((t, i) => {
    const next = tokens[i + 1];
    const prev = tokens[i - 1];
    if (t.type === 'string' && t.endLine > t.line) {
      problems.push(
        warning(t, `This string goes on to line ${t.endLine}. Is a closing ${t.text[0]} missing on this line?`)
      );
    }
    if (t.type === 'operator' && FOREIGN_OPERATORS[t.text]) {
      problems.push(warning(t, `Logs Insights uses ${FOREIGN_OPERATORS[t.text]}, not ${t.text}`));
    }
    // name( with no space: a function call.
    if (t.type === 'word' && next?.type === 'open' && next.text === '(' && !next.spaced) {
      const name = t.text.toLowerCase();
      if (!KNOWN_FUNCTIONS.has(name) && !COMMAND_NAMES.has(name)) {
        const guess = closest(t.text, FUNCTION_NAMES);
        problems.push(warning(t, `Unknown function "${t.text}"${guess ? `. Did you mean "${guess}"?` : ''}`));
      }
    }
    // foo-bar with no spaces is foo minus bar: a field name with a hyphen needs backticks.
    if (
      t.type === 'operator' &&
      t.text === '-' &&
      prev?.type === 'word' &&
      next?.type === 'word' &&
      !t.spaced &&
      !next.spaced
    ) {
      problems.push({
        ...span(prev, next),
        severity: 'warning',
        message: `This is ${prev.text} minus ${next.text}. A field name with a hyphen needs backticks: \`${prev.text}-${next.text}\``,
      });
    }
  });
  return problems;
}

interface Stage {
  /** The | before the stage; absent for the first one. */
  pipe?: Token;
  tokens: Token[];
  /** Known command, as documented. */
  command?: string;
}

/** Stages of the query itself; pipes inside brackets belong to a subquery and stay in their stage. */
function splitStages(tokens: Token[]): Stage[] {
  const stages: Stage[] = [{ tokens: [] }];
  let depth = 0;
  for (const t of tokens) {
    if (t.type === 'open') {
      depth++;
    } else if (t.type === 'close') {
      depth = Math.max(0, depth - 1);
    }
    if (t.type === 'pipe' && depth === 0) {
      stages.push({ pipe: t, tokens: [] });
    } else {
      stages[stages.length - 1].tokens.push(t);
    }
  }
  stages.forEach((s) => {
    const first = s.tokens[0];
    s.command = first?.type === 'word' ? COMMAND_NAMES.get(first.text.toLowerCase()) : undefined;
  });
  // An empty query has nothing to check.
  return stages.length === 1 && stages[0].tokens.length === 0 ? [] : stages;
}

function checkStage({ pipe, tokens, command }: Stage): QueryProblem[] {
  const [first, ...args] = tokens;
  if (!first) {
    return pipe ? [error(pipe, 'Expected a command after |')] : [];
  }
  if (!command) {
    return checkUnknownCommand(first, args[0]);
  }
  if (args.length === 0 && NEEDS_ARGUMENTS.has(command)) {
    return [error(first, `"${command}" needs arguments`)];
  }
  if (command === 'sort') {
    return checkSort(args);
  }
  if (command === 'limit') {
    return checkLimit(args);
  }
  if (LIST_COMMANDS.has(command)) {
    return checkList(args);
  }
  return [];
}

/**
 * Not a documented command. Logs Insights may add commands later, but an unknown word is far more
 * often a typo: COMMANDS is kept up to date with the documentation instead.
 */
function checkUnknownCommand(first: Token, second: Token | undefined): QueryProblem[] {
  if (first.type !== 'word') {
    return [error(first, `Expected a command, found ${first.text}`)];
  }
  const guess = closest(first.text, COMMANDS);
  if (guess) {
    return [error(first, `Unknown command "${first.text}". Did you mean "${guess}"?`)];
  }
  if (second?.type === 'operator' && COMPARISONS.has(second.text)) {
    return [error(first, `Expected a command, found "${first.text}". Missing "filter"?`)];
  }
  return [error(first, `Unknown command "${first.text}"`)];
}

/** A sort key is an expression optionally followed by asc or desc. */
function checkSort(args: Token[]): QueryProblem[] {
  const problems: QueryProblem[] = [];
  for (const key of splitTopLevel(args)) {
    const last = key[key.length - 1];
    const before = key[key.length - 2];
    if (!last || !before || last.type !== 'word' || before.type === 'operator' || before.type === 'open') {
      continue;
    }
    // After "as" it is an alias, whatever it looks like.
    if (before.text.toLowerCase() === 'as' || ['asc', 'desc'].includes(last.text.toLowerCase())) {
      continue;
    }
    const guess = closest(last.text, ['asc', 'desc']);
    problems.push(
      guess
        ? error(last, `Expected asc or desc, found "${last.text}". Did you mean "${guess}"?`)
        : error(last, `Expected asc, desc or a comma before "${last.text}"`)
    );
  }
  return problems;
}

/** limit N or limit any N, N a positive whole number. */
function checkLimit(args: Token[]): QueryProblem[] {
  const values = args[0]?.text.toLowerCase() === 'any' ? args.slice(1) : args;
  if (values.length === 0) {
    return [error(args[0], 'limit any needs a number')];
  }
  const [value, ...rest] = values;
  if (rest.length > 0) {
    return [{ ...span(rest[0], rest[rest.length - 1]), severity: 'error', message: 'limit takes a single number' }];
  }
  const n = Number(value.text);
  if (value.type !== 'number' || !Number.isInteger(n) || n < 1) {
    return [error(value, 'limit must be a whole number greater than 0')];
  }
  if (n > MAX_LIMIT) {
    return [warning(value, `limit can be at most ${MAX_LIMIT.toLocaleString('en-US')}`)];
  }
  return [];
}

/** fields a b: two expressions with no comma between them. */
function checkList(args: Token[]): QueryProblem[] {
  const problems: QueryProblem[] = [];
  let depth = 0;
  args.forEach((t, i) => {
    const prev = args[i - 1];
    if (t.type === 'open') {
      depth++;
    } else if (t.type === 'close') {
      depth = Math.max(0, depth - 1);
    }
    const ends = (p: Token) => p.type === 'word' || p.type === 'number' || p.type === 'string' || p.type === 'close';
    if (
      depth === 0 &&
      prev &&
      ends(prev) &&
      (t.type === 'word' || t.type === 'number' || t.type === 'string') &&
      !CONNECTORS.has(t.text.toLowerCase()) &&
      !CONNECTORS.has(prev.text.toLowerCase())
    ) {
      problems.push(error(t, `Missing comma before "${t.text}"`));
    }
  });
  return problems;
}

/** Documented: sort and limit must come after the last stats; estimate must be the last command. */
function checkStageOrder(stages: Stage[]): QueryProblem[] {
  const problems: QueryProblem[] = [];
  const lastStats = stages.map((s) => s.command).lastIndexOf('stats');
  stages.forEach((s, i) => {
    if ((s.command === 'sort' || s.command === 'limit') && i < lastStats) {
      problems.push(error(s.tokens[0], `${s.command} must come after the last stats`));
    }
    if (s.command === 'estimate' && i < stages.length - 1) {
      problems.push(error(s.tokens[0], 'estimate must be the last command'));
    }
  });
  return problems;
}

/** Splits arguments at commas outside brackets. */
function splitTopLevel(tokens: Token[]): Token[][] {
  const parts: Token[][] = [[]];
  let depth = 0;
  for (const t of tokens) {
    if (t.type === 'open') {
      depth++;
    } else if (t.type === 'close') {
      depth = Math.max(0, depth - 1);
    }
    if (t.type === 'comma' && depth === 0) {
      parts.push([]);
    } else {
      parts[parts.length - 1].push(t);
    }
  }
  return parts;
}

/** The option a typo most likely meant: one edit away for short words, two for longer ones. */
function closest(word: string, options: string[]): string | undefined {
  const lower = word.toLowerCase();
  let best: { option: string; distance: number } | undefined;
  for (const option of options) {
    const distance = editDistance(lower, option.toLowerCase());
    if (distance > 0 && distance <= (option.length <= 4 ? 1 : 2) && (!best || distance < best.distance)) {
      best = { option, distance };
    }
  }
  return best?.option;
}

/** Edits (insert, delete, replace, swap two neighbours) to turn a into b. */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) {
    d[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

const at = (t: Token) => ({ line: t.line, column: t.column, endColumn: t.endColumn });
const error = (t: Token, message: string): QueryProblem => ({ ...at(t), severity: 'error', message });
const warning = (t: Token, message: string): QueryProblem => ({ ...at(t), severity: 'warning', message });

/** From the start of one token to the end of another on the same line (else just the first). */
const span = (from: Token, to: Token) =>
  from.line === to.line ? { line: from.line, column: from.column, endColumn: to.endColumn } : at(from);

/** "Line 2, column 33: ..." for showing problems outside the editor. */
export function formatProblem(p: QueryProblem): string {
  return `Line ${p.line}, column ${p.column}: ${p.message}`;
}
