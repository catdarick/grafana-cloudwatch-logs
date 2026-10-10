import { CommandSpec, findCommand, unquoteField } from './spec';
import { Token, tokenize } from './tokenize';

/** One command of a query: what lies between two pipes. */
export interface Stage {
  /** The | before it; absent for the first stage. */
  pipe?: Token;
  /** First token: the command, if it is a word. */
  head?: Token;
  /** The documented command, if the head is one. */
  command?: CommandSpec;
  /** Everything after the head, subqueries included. */
  args: Token[];
  /** Subqueries in brackets, e.g. filter x in (SOURCE ... | fields x). */
  subqueries: Stage[][];
}

export interface ParsedQuery {
  /** Tokens without comments. */
  tokens: Token[];
  stages: Stage[];
}

export function parseQuery(query: string): ParsedQuery {
  const tokens = tokenize(query).tokens.filter((t) => t.type !== 'comment');
  const closes = matchBrackets(tokens);

  const stagesOf = (from: number, to: number): Stage[] => {
    const stages: Stage[] = [{ args: [], subqueries: [] }];
    let current = stages[0];
    let depth = 0;
    for (let i = from; i < to; i++) {
      const t = tokens[i];
      if (t.type === 'pipe' && depth === 0) {
        current = { pipe: t, args: [], subqueries: [] };
        stages.push(current);
        continue;
      }
      if (current.head) {
        current.args.push(t);
      } else {
        current.head = t;
        current.command = t.role === 'command' ? findCommand(t.text) : undefined;
      }
      if (t.type === 'open') {
        const close = Math.min(closes.get(i) ?? to, to);
        // A bracket whose first word stands as a command holds a subquery with stages of its own.
        if (tokens[i + 1]?.role === 'command' && i + 1 < close) {
          current.subqueries.push(stagesOf(i + 1, close));
          current.args.push(...tokens.slice(i + 1, Math.min(close + 1, to)));
          i = Math.min(close, to - 1);
        } else {
          depth++;
        }
      } else if (t.type === 'close') {
        depth = Math.max(0, depth - 1);
      }
    }
    // An empty query has no stages.
    return stages.length === 1 && !stages[0].head ? [] : stages;
  };

  return { tokens, stages: stagesOf(0, tokens.length) };
}

const PAIRS: Record<string, string> = { ')': '(', ']': '[' };

/** Index of each opening bracket's closing one; unclosed ones are left out. */
function matchBrackets(tokens: Token[]): Map<number, number> {
  const closes = new Map<number, number>();
  const open: number[] = [];
  tokens.forEach((t, i) => {
    if (t.type === 'open') {
      open.push(i);
    } else if (t.type === 'close' && open.length > 0 && tokens[open[open.length - 1]].text === PAIRS[t.text]) {
      closes.set(open.pop()!, i);
    }
  });
  return closes;
}

/** Splits tokens at commas outside brackets: sort keys, fields of a list. */
export function splitArgs(tokens: Token[]): Token[][] {
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

export interface SortKey {
  field: string;
  desc: boolean;
}

/**
 * Keys of the query's last sort, e.g. "sort @timestamp desc, level" → two keys. Stops at the first
 * key that is an expression rather than a field: rows can only be re-sorted by their columns.
 */
export function sortKeys(query: string): SortKey[] {
  const sorts = parseQuery(query).stages.filter((s) => s.command?.name === 'sort');
  const sort = sorts[sorts.length - 1];
  const keys: SortKey[] = [];
  for (const part of sort ? splitArgs(sort.args) : []) {
    const last = part[part.length - 1];
    const direction = last?.role === 'keyword' ? last.text.toLowerCase() : undefined;
    const expression = direction === 'asc' || direction === 'desc' ? part.slice(0, -1) : part;
    if (expression.length !== 1 || expression[0].type !== 'word') {
      break;
    }
    keys.push({ field: unquoteField(expression[0].text), desc: direction === 'desc' });
  }
  return keys;
}

// Commands that limit or reshape the logs: a filter added after them would not narrow the logs.
const LATE_COMMANDS = new Set(['sort', 'limit', 'stats', 'dedup', 'display']);

const lateStage = (query: string) => parseQuery(query).stages.find((s) => LATE_COMMANDS.has(s.command?.name ?? ''));

/**
 * Adds a clause as a stage of its own before the first sort/limit/stats/dedup/display, so it
 * narrows the logs rather than the already limited or aggregated output.
 */
export function addQueryStage(query: string, clause: string): string {
  const stage = lateStage(query);
  if (!stage?.head) {
    return `${query.trimEnd()}\n| ${clause}`;
  }
  if (!stage.pipe) {
    const at = stage.head.offset;
    return `${query.slice(0, at)}${clause}\n| ${query.slice(at)}`;
  }
  const at = stage.pipe.offset;
  return `${query.slice(0, at).trimEnd()}\n| ${clause}\n${query.slice(at)}`;
}

/**
 * Line after which addQueryStage puts a clause, for showing it in place before it is added: the
 * line before a sort/limit/... stage that starts its own line, the line holding one mid-line, or
 * the last line with text. 0 means before the first line.
 */
export function queryStageLine(query: string): number {
  const lines = query.split('\n');
  const stage = lateStage(query);
  if (!stage?.head) {
    let last = lines.length;
    while (last > 1 && lines[last - 1].trim() === '') {
      last--;
    }
    return last;
  }
  const start = stage.pipe ?? stage.head;
  const startsLine = lines[start.line - 1].slice(0, start.column - 1).trim() === '';
  return startsLine ? start.line - 1 : start.line;
}

/** Whether the query refers to the field anywhere outside comments and strings. */
export function mentionsField(query: string, field: string): boolean {
  return parseQuery(query).tokens.some((t) => t.type === 'word' && unquoteField(t.text) === field);
}
