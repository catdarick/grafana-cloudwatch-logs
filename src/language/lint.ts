import { COMMANDS } from './logsInsights';

/**
 * A mistake found in a query, positioned the way Monaco counts: lines and columns from 1, the end
 * column exclusive.
 */
export interface QueryProblem {
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
}

const COMMAND_NAMES = new Map(COMMANDS.map((c) => [c.toLowerCase(), c]));
const NEEDS_ARGUMENTS = new Set(['fields', 'display', 'filter', 'stats', 'sort', 'limit', 'parse', 'dedup']);
// After these a slash starts a regex, not a division.
const REGEX_AFTER_WORDS = new Set(['like', 'not', 'and', 'or', 'in', 'filter', 'parse']);
const PAIRS: Record<string, string> = { ')': '(', ']': '[' };
const MAX_LIMIT = 10000;

/**
 * Catches the common mistakes in a Logs Insights query: unknown commands, unclosed quotes, regexes
 * and brackets, empty stages, a sort direction other than asc/desc, a bad limit. Grafana 10.4
 * replaces CloudWatch's own syntax errors with a generic message, so this is what the user gets
 * instead. It does not try to be a full parser: anything it does not understand passes.
 */
export function lintQuery(query: string): QueryProblem[] {
  const { tokens, problems } = tokenize(query);
  problems.push(...checkBrackets(tokens));
  for (const stage of splitStages(tokens)) {
    problems.push(...checkStage(stage));
  }
  return problems.sort((a, b) => a.line - b.line || a.column - b.column);
}

function tokenize(query: string): { tokens: Token[]; problems: QueryProblem[] } {
  const tokens: Token[] = [];
  const problems: QueryProblem[] = [];
  const lines = query.split('\n');
  // Command of the current stage: in parse, a slash after the field starts the pattern.
  let command: string | undefined;

  const push = (type: TokenType, text: string, line: number, column: number) => {
    tokens.push({ type, text, line, column, endColumn: column + text.length });
    if (type === 'pipe') {
      command = undefined;
    } else if (command === undefined) {
      command = text.toLowerCase();
    }
  };

  const regexAllowed = () => {
    const prev = tokens[tokens.length - 1];
    if (!prev || command === 'parse') {
      return true;
    }
    if (prev.type === 'word') {
      return REGEX_AFTER_WORDS.has(prev.text.toLowerCase());
    }
    return prev.type !== 'number' && prev.type !== 'string' && prev.type !== 'regex' && prev.type !== 'close';
  };

  for (let l = 0; l < lines.length; l++) {
    const text = lines[l];
    const line = l + 1;
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      const column = i + 1;
      if (/\s/.test(ch)) {
        i++;
      } else if (ch === '#') {
        break;
      } else if (ch === "'" || ch === '"' || ch === '`' || (ch === '/' && regexAllowed())) {
        const end = closingIndex(text, i);
        if (end < 0) {
          const what = ch === '/' ? 'regex' : ch === '`' ? 'backtick' : 'quote';
          problems.push({
            line,
            column,
            endColumn: text.length + 1,
            message: `Unclosed ${what}: ${ch} has no matching ${ch} on this line`,
          });
          push(ch === '/' ? 'regex' : 'string', text.slice(i), line, column);
          i = text.length;
        } else {
          // Regex flags (/abc/i) belong to the regex.
          let stop = end + 1;
          if (ch === '/') {
            while (stop < text.length && /[a-z]/i.test(text[stop])) {
              stop++;
            }
          }
          // A backtick-quoted name is a field, like a bare word.
          push(ch === '/' ? 'regex' : ch === '`' ? 'word' : 'string', text.slice(i, stop), line, column);
          i = stop;
        }
      } else if (ch === '|') {
        push('pipe', ch, line, column);
        i++;
      } else if (ch === ',') {
        push('comma', ch, line, column);
        i++;
      } else if (ch === '(' || ch === '[') {
        push('open', ch, line, column);
        i++;
      } else if (ch === ')' || ch === ']') {
        push('close', ch, line, column);
        i++;
      } else {
        const match =
          /^[@A-Za-z_$][\w.@$]*/.exec(text.slice(i)) ??
          /^\d[\w.]*/.exec(text.slice(i)) ??
          /^[=<>!~+\-*/%^:]+/.exec(text.slice(i));
        const word = match?.[0] ?? ch;
        push(/^\d/.test(word) ? 'number' : /^[@A-Za-z_$]/.test(word) ? 'word' : 'operator', word, line, column);
        i += word.length;
      }
    }
  }
  return { tokens, problems };
}

/** Index of the quote that closes the one at `start`, skipping escaped characters; -1 if none. */
function closingIndex(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
    } else if (text[i] === quote) {
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
        problems.push({ ...at(t), message: `Unexpected ${t.text}: there is no ${PAIRS[t.text]} for it to close` });
      }
    }
  }
  open.forEach((t) => problems.push({ ...at(t), message: `Unclosed ${t.text}` }));
  return problems;
}

interface Stage {
  /** The | before the stage; absent for the first one. */
  pipe?: Token;
  tokens: Token[];
}

function splitStages(tokens: Token[]): Stage[] {
  const stages: Stage[] = [{ tokens: [] }];
  for (const t of tokens) {
    if (t.type === 'pipe') {
      stages.push({ pipe: t, tokens: [] });
    } else {
      stages[stages.length - 1].tokens.push(t);
    }
  }
  // An empty query has nothing to check.
  return stages.length === 1 && stages[0].tokens.length === 0 ? [] : stages;
}

function checkStage({ pipe, tokens }: Stage): QueryProblem[] {
  const [first, ...args] = tokens;
  if (!first) {
    return pipe ? [{ ...at(pipe), message: 'Expected a command after |' }] : [];
  }
  const command = first.type === 'word' ? COMMAND_NAMES.get(first.text.toLowerCase()) : undefined;
  if (!command) {
    const guess = first.type === 'word' ? closest(first.text, COMMANDS) : undefined;
    return [
      {
        ...at(first),
        message: `Unknown command "${first.text}"${guess ? `. Did you mean "${guess}"?` : `. Expected one of: ${COMMANDS.join(', ')}`}`,
      },
    ];
  }
  if (args.length === 0 && NEEDS_ARGUMENTS.has(command)) {
    return [{ ...at(first), message: `"${command}" needs arguments` }];
  }
  if (command === 'sort') {
    return checkSort(args);
  }
  if (command === 'limit') {
    return checkLimit(first, args);
  }
  return [];
}

/** Each sort key is an expression optionally followed by asc or desc. */
function checkSort(args: Token[]): QueryProblem[] {
  const problems: QueryProblem[] = [];
  for (const key of splitTopLevel(args)) {
    const last = key[key.length - 1];
    const before = key[key.length - 2];
    if (!last) {
      continue;
    }
    const direction = last.text.toLowerCase();
    // "field word": a direction is the only thing that can follow a sort expression.
    if (
      last.type === 'word' &&
      before &&
      before.type !== 'operator' &&
      before.type !== 'open' &&
      direction !== 'asc' &&
      direction !== 'desc'
    ) {
      const guess = closest(last.text, ['asc', 'desc']);
      problems.push({
        ...at(last),
        message: `Expected asc or desc, found "${last.text}"${guess ? `. Did you mean "${guess}"?` : ''}`,
      });
    }
  }
  return problems;
}

function checkLimit(command: Token, args: Token[]): QueryProblem[] {
  const [value, ...rest] = args;
  if (rest.length > 0) {
    return [{ ...span(rest[0], rest[rest.length - 1]), message: 'limit takes a single number' }];
  }
  const n = Number(value.text);
  if (value.type !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    return [{ ...at(value), message: `limit must be a whole number from 1 to ${MAX_LIMIT}` }];
  }
  return [];
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

/** The option a typo most likely meant: at most two edits away (one for short words). */
function closest(word: string, options: string[]): string | undefined {
  const lower = word.toLowerCase();
  let best: { option: string; distance: number } | undefined;
  for (const option of options) {
    const distance = editDistance(lower, option.toLowerCase());
    if (distance <= (option.length <= 4 ? 1 : 2) && (!best || distance < best.distance)) {
      best = { option, distance };
    }
  }
  return best?.option;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

const at = (t: Token) => ({ line: t.line, column: t.column, endColumn: t.endColumn });

/** From the start of one token to the end of another on the same line (else just the first). */
const span = (from: Token, to: Token) =>
  from.line === to.line ? { line: from.line, column: from.column, endColumn: to.endColumn } : at(from);

/** "Line 2, column 33: ..." for showing problems outside the editor. */
export function formatProblem(p: QueryProblem): string {
  return `Line ${p.line}, column ${p.column}: ${p.message}`;
}
