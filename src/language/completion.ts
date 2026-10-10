import { COMMANDS, FUNCTIONS, SYSTEM_FIELDS, fieldRef } from './spec';
import { Token, tokenize } from './tokenize';

/**
 * What can come at the cursor:
 * - command: a command (query start, after |)
 * - expression: a field or function (after a command, operator, comma or bracket)
 * - operator: a keyword that continues after a value (and, or, like, as, by...)
 * - sortDirection: asc or desc after a sort key
 * - limit: any, after limit
 */
export type CompletionContext = 'command' | 'expression' | 'operator' | 'sortDirection' | 'limit';

export interface Completion {
  label: string;
  kind: 'command' | 'function' | 'field' | 'keyword';
  insertText: string;
  /** insertText has a $0 for where the cursor goes. */
  snippet?: boolean;
  /** What the typed text is matched against, when not the label. */
  filterText?: string;
  detail?: string;
  documentation?: string;
  sortText: string;
}

export interface Completions {
  context: CompletionContext;
  /** Offset where the replaced text starts: the start of the word being typed, or the cursor. */
  from: number;
  items: Completion[];
}

const value = (t: Token | undefined) =>
  t !== undefined && (t.role === 'field' || ['number', 'string', 'regex', 'close'].includes(t.type));

/**
 * Suggestions at an offset of the query, read with the same tokenizer as highlighting and the
 * checker: a word in command position is completed as a command, nothing inside a string or
 * comment. `fields` are the field names known for the selected log groups.
 */
export function getCompletions(query: string, offset: number, fields: string[]): Completions | undefined {
  const { tokens } = tokenize(query.slice(0, offset));
  const last = tokens[tokens.length - 1];
  const touching = last !== undefined && last.endOffset === offset;
  if (touching && (last.type === 'comment' || (last.open && last.type !== 'word'))) {
    return undefined;
  }
  // The word being typed, if the cursor is at its end; anything else right at the cursor
  // (a number, a closing quote or bracket) leaves nothing to complete.
  const word = touching && last.type === 'word' ? last : undefined;
  if (touching && !word && ['number', 'string', 'regex', 'close'].includes(last.type)) {
    return undefined;
  }
  const from = word ? word.offset : offset;
  const before = tokenize(query.slice(0, from));
  const prev = before.tokens.filter((t) => t.type !== 'comment').pop();
  const state = before.state;
  const command = state.command;
  // Directly in the stage's arguments, not inside a bracket of them.
  const topLevel = state.outer.length === state.commandDepth;
  const typed = word?.text ?? '';

  if (state.expect === 'command') {
    // Right after | with no space, the command gets one.
    const pad = !word && offset > 0 && !/\s/.test(query[offset - 1]) ? ' ' : '';
    return { context: 'command', from, items: commandItems(pad) };
  }
  if (prev?.role === 'keyword' && ['as', 'into'].includes(prev.text.toLowerCase())) {
    // A new name: nothing to suggest.
    return undefined;
  }
  if (command === 'limit' && topLevel) {
    return prev?.role === 'command' ? { context: 'limit', from, items: [keyword('any', '0')] } : undefined;
  }
  if (command === 'sort' && topLevel && value(prev)) {
    return { context: 'sortDirection', from, items: [keyword('desc', '0'), keyword('asc', '1')] };
  }
  if (value(prev)) {
    const words = ['and', 'or', 'like', 'in', 'not', 'as', ...(command === 'stats' ? ['by'] : [])];
    return { context: 'operator', from, items: words.map((w, i) => keyword(w, String(i))) };
  }
  const items = [...fieldItems(fields, typed), ...functionItems(), keyword('not', '3')];
  // After a bracket, a subquery may start: SOURCE ... | ...
  if (state.expect === 'subquery') {
    items.push(...commandItems('').map((c) => ({ ...c, sortText: `4${c.sortText}` })));
  }
  return { context: 'expression', from, items };
}

function commandItems(pad: string): Completion[] {
  return COMMANDS.map((c, i) => ({
    label: c.name,
    kind: 'command',
    insertText: `${pad}${c.name}${c.args === 'none' ? '' : ' '}`,
    detail: c.description,
    // Commands come in the order of the spec: the most used first.
    sortText: String(i).padStart(3, '0'),
  }));
}

function fieldItems(fields: string[], typed: string): Completion[] {
  const system = new Map(SYSTEM_FIELDS.map((f) => [f.name, f.description]));
  const names = Array.from(new Set([...fields, ...system.keys()]));
  return names.map((name) => {
    const ref = fieldRef(name);
    return {
      label: name,
      kind: 'field',
      // Inserted the way the query must spell it: request-id becomes `request-id`.
      insertText: ref,
      // Match what is typed: the name itself, or the quoted form once a backtick is typed.
      filterText: typed.includes('`') ? ref : name,
      detail: system.get(name) ?? 'field',
      sortText: `1${name}`,
    };
  });
}

function functionItems(): Completion[] {
  return FUNCTIONS.map((f) => ({
    label: f.name,
    kind: 'function',
    insertText: f.params ? `${f.name}($0)` : `${f.name}()`,
    snippet: true,
    detail: `${f.name}(${f.params})`,
    documentation: f.description,
    sortText: `2${f.name}`,
  }));
}

function keyword(word: string, order: string): Completion {
  return { label: word, kind: 'keyword', insertText: word, sortText: `3${order}` };
}
