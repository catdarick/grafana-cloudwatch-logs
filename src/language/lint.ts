import { Stage, parseQuery, splitArgs } from './parse';
import { COMMANDS, FUNCTIONS, findFunction, needsOperand } from './spec';
import { Token } from './tokenize';

/**
 * A mistake found in a query, positioned the way Monaco counts: lines and columns from 1, the end
 * column exclusive.
 *
 * - error: breaks the documented grammar, certain to fail.
 * - warning: not in the documented vocabulary (an unknown command or function). Likely wrong, but
 *   AWS keeps adding commands and functions, so it may be valid.
 * - hint: valid, but often a mistake; worth showing once the query has failed.
 */
export interface QueryProblem {
  severity: 'error' | 'warning' | 'hint';
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
}

const COMPARISONS = new Set(['=', '!=', '<', '>', '<=', '>=', '=~']);
const FOREIGN_OPERATORS: Record<string, string> = { '==': '=', '&&': 'and', '||': 'or' };
const PAIRS: Record<string, string> = { ')': '(', ']': '[' };
// Operators that take a value after them; * is left out (count(*)), and so are : { } of SOURCE.
const OPERATOR = /^(?:[=<>!~+\-/%^]+|&&|\|\|)$/;
const MAX_LIMIT = 100000;
const COMMAND_NAMES = COMMANDS.map((c) => c.name);
const FUNCTION_NAMES = FUNCTIONS.map((f) => f.name);

/**
 * Checks a Logs Insights query against the documented syntax. Grafana 10.4 replaces CloudWatch's
 * own syntax errors with a generic message, so this is what the user gets instead. Errors are
 * only what is certain to fail: a false alarm on a valid query is worse than a missed mistake.
 */
export function lintQuery(query: string): QueryProblem[] {
  const { tokens, stages } = parseQuery(query);
  const problems = [...checkTokens(tokens), ...checkBrackets(tokens), ...checkStages(stages)];
  return problems.sort((a, b) => a.line - b.line || a.column - b.column);
}

function checkTokens(tokens: Token[]): QueryProblem[] {
  const problems: QueryProblem[] = [];
  tokens.forEach((t, i) => {
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    if (t.open) {
      // Only the line it starts on: the rest of the query is not the mistake.
      const where = { ...at(t), endLine: t.line, endColumn: t.column + t.text.split('\n')[0].length };
      const what = t.type === 'string' ? `string: ${t.text[0]}` : t.type === 'regex' ? 'regex: /' : 'backtick: `';
      const scope = t.type === 'string' ? '' : ' on this line';
      problems.push({ ...where, severity: 'error', message: `Unclosed ${what} has no closing pair${scope}` });
    } else if (t.type === 'string' && t.endLine > t.line) {
      problems.push(hint(t, `This string goes on to line ${t.endLine}. Is a closing ${t.text[0]} missing?`));
    }
    // Nothing after it in its stage, list or brackets: sort a as, filter a =, fields a,
    const missing = !next || ['pipe', 'comma', 'close'].includes(next.type);
    if (
      missing &&
      ((t.role === 'keyword' && needsOperand(t.text)) || (t.type === 'operator' && OPERATOR.test(t.text)))
    ) {
      const what = ['as', 'into'].includes(t.text.toLowerCase()) ? 'a name' : 'a value';
      problems.push(error(t, `Expected ${what} after "${t.text}"`));
    } else if (missing && t.type === 'comma') {
      problems.push(error(t, 'Expected a value after ","'));
    }
    if (t.type === 'operator' && FOREIGN_OPERATORS[t.text]) {
      problems.push(warning(t, `Logs Insights uses ${FOREIGN_OPERATORS[t.text]}, not ${t.text}`));
    }
    if (t.role === 'function' && !findFunction(t.text)) {
      const guess = closest(t.text, FUNCTION_NAMES);
      problems.push(warning(t, `Unknown function "${t.text}"${guess ? `. Did you mean "${guess}"?` : ''}`));
    }
    // foo-bar with no spaces is foo minus bar: a field name with a hyphen needs backticks.
    if (t.text === '-' && prev?.role === 'field' && next?.role === 'field' && !t.spaced && !next.spaced) {
      problems.push({
        ...span(prev, next),
        severity: 'hint',
        message: `This is ${prev.text} minus ${next.text}. A field name with a hyphen needs backticks: \`${prev.text}-${next.text}\``,
      });
    }
  });
  return problems;
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

/** Each stage, the order of stages, and the stages of subqueries the same way. */
function checkStages(stages: Stage[]): QueryProblem[] {
  const problems = stages.flatMap(checkStage);
  const lastStats = stages.map((s) => s.command?.name).lastIndexOf('stats');
  stages.forEach((s, i) => {
    const name = s.command?.name;
    if ((name === 'sort' || name === 'limit') && i < lastStats) {
      problems.push(error(s.head!, `${name} must come after the last stats`));
    }
    if (name === 'estimate' && i < stages.length - 1) {
      problems.push(error(s.head!, 'estimate must be the last command'));
    }
  });
  stages.forEach((s) => s.subqueries.forEach((sub) => problems.push(...checkStages(sub))));
  return problems;
}

function checkStage({ pipe, head, command, args }: Stage): QueryProblem[] {
  if (!head) {
    return pipe ? [error(pipe, 'Expected a command after |')] : [];
  }
  if (head.type !== 'word') {
    return [error(head, `Expected a command, found ${head.text}`)];
  }
  if (!command) {
    return [unknownCommand(head, args[0])];
  }
  if (args.length === 0 && command.args === 'required') {
    return [error(head, `"${command.name}" needs arguments`)];
  }
  if (command.name === 'sort') {
    return checkSort(args);
  }
  if (command.name === 'limit') {
    return checkLimit(args);
  }
  return command.list ? checkList(args) : [];
}

/** Not a documented command: likely a typo, but it may be one added since. */
function unknownCommand(head: Token, next: Token | undefined): QueryProblem {
  const guess = closest(head.text, COMMAND_NAMES);
  if (guess) {
    return warning(head, `Unknown command "${head.text}". Did you mean "${guess}"?`);
  }
  if (next?.type === 'operator' && COMPARISONS.has(next.text)) {
    return warning(head, `Unknown command "${head.text}". Missing "filter"?`);
  }
  return warning(head, `Unknown command "${head.text}"`);
}

/** Each sort key is an expression, then asc or desc, if anything. */
function checkSort(args: Token[]): QueryProblem[] {
  const problems: QueryProblem[] = [];
  for (const key of splitArgs(args)) {
    const last = key[key.length - 1];
    const before = key[key.length - 2];
    // A word right after a value; after an operator or keyword it is part of the expression.
    if (last?.role !== 'field' || !before || !endsValue(before)) {
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

/** fields a b: two values with no comma between them. */
function checkList(args: Token[]): QueryProblem[] {
  const problems: QueryProblem[] = [];
  let depth = 0;
  args.forEach((t, i) => {
    if (t.type === 'open') {
      depth++;
    } else if (t.type === 'close') {
      depth = Math.max(0, depth - 1);
    }
    const prev = args[i - 1];
    const startsValue = t.role === 'field' || t.role === 'function' || t.type === 'number' || t.type === 'string';
    if (depth === 0 && prev && endsValue(prev) && startsValue) {
      problems.push(error(t, `Missing comma before "${t.text}"`));
    }
  });
  return problems;
}

/** A field, number, string, regex or closing bracket: what an expression can end with. */
function endsValue(t: Token): boolean {
  return t.role === 'field' || ['number', 'string', 'regex', 'close'].includes(t.type);
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

const at = (t: Token) => ({ line: t.line, column: t.column, endLine: t.endLine, endColumn: t.endColumn });
const error = (t: Token, message: string): QueryProblem => ({ ...at(t), severity: 'error', message });
const warning = (t: Token, message: string): QueryProblem => ({ ...at(t), severity: 'warning', message });
const hint = (t: Token, message: string): QueryProblem => ({ ...at(t), severity: 'hint', message });

/** From the start of one token to the end of another. */
const span = (from: Token, to: Token) => ({
  line: from.line,
  column: from.column,
  endLine: to.endLine,
  endColumn: to.endColumn,
});

/** "Line 2, column 33: ..." for showing problems outside the editor. */
export function formatProblem(p: QueryProblem): string {
  return `Line ${p.line}, column ${p.column}: ${p.message}`;
}
