import { findCommand, isKeyword } from './spec';

export type TokenType =
  'word' | 'number' | 'string' | 'regex' | 'pipe' | 'comma' | 'open' | 'close' | 'operator' | 'comment';

/** What a word is, from where it stands: the first word of a stage is a command whatever it says. */
export type WordRole = 'command' | 'keyword' | 'function' | 'field';

/**
 * Where the tokenizer is at the end of a line, so the next line can be read on its own: Monaco
 * tokenizes line by line and re-reads only the lines after an edit.
 */
export interface LexState {
  /** Quote of a string that goes on past the end of the line. */
  string?: string;
  /** The next word is a command (query start, after |), may be one (after a bracket: a subquery), or is not. */
  expect: 'command' | 'subquery' | 'any';
  /** Whether a / here starts a regex rather than a division: a division needs something to divide. */
  regex: boolean;
  /** Command of the current stage, lowercased. */
  command?: string;
  /** Brackets the command sits inside of: brackets opened in its stage are its arguments. */
  commandDepth: number;
  /** Per open bracket, the command and depth to go back to when it closes (a subquery has its own). */
  outer: Array<[string | undefined, number]>;
}

export const INITIAL_STATE: LexState = { expect: 'command', regex: true, commandDepth: 0, outer: [] };

export interface LineToken {
  type: TokenType;
  role?: WordRole;
  text: string;
  /** Index in the line; end is exclusive. */
  start: number;
  end: number;
  /** White space, a comment or the line start right before it. */
  spaced: boolean;
  /** A string, regex or backtick not closed on this line. */
  open?: boolean;
  /** The rest of a string from the previous line. */
  continued?: boolean;
}

export function cloneState(s: LexState): LexState {
  return { ...s, outer: s.outer.map(([c, d]) => [c, d]) };
}

export function sameState(a: LexState, b: LexState): boolean {
  return (
    a.string === b.string &&
    a.expect === b.expect &&
    a.regex === b.regex &&
    a.command === b.command &&
    a.commandDepth === b.commandDepth &&
    a.outer.length === b.outer.length &&
    a.outer.every(([c, d], i) => c === b.outer[i][0] && d === b.outer[i][1])
  );
}

/** Tokens of one line, given the state at its start. */
export function tokenizeLine(line: string, state: LexState): { tokens: LineToken[]; state: LexState } {
  const s = cloneState(state);
  const tokens: LineToken[] = [];
  let spaced = true;
  let i = 0;

  const push = (type: TokenType, start: number, end: number, extra: Partial<LineToken> = {}) => {
    tokens.push({ type, text: line.slice(start, end), start, end, spaced, ...extra });
    spaced = false;
  };
  // After a value (field, number, string...): a slash divides, a word is not a command.
  const afterValue = () => {
    s.regex = false;
    s.expect = 'any';
  };

  if (s.string) {
    const close = closingIndex(line, 0, s.string);
    if (close < 0) {
      push('string', 0, line.length, { open: true, continued: true });
      return { tokens, state: s };
    }
    push('string', 0, close + 1, { continued: true });
    s.string = undefined;
    afterValue();
    i = close + 1;
  }

  while (i < line.length) {
    const ch = line[i];
    const rest = line.slice(i);
    if (/\s/.test(ch)) {
      i++;
      spaced = true;
    } else if (ch === '#') {
      push('comment', i, line.length);
      break;
    } else if (ch === "'" || ch === '"') {
      const close = closingIndex(line, i + 1, ch);
      if (close < 0) {
        // Strings may go on over several lines.
        push('string', i, line.length, { open: true });
        s.string = ch;
        break;
      }
      push('string', i, close + 1);
      afterValue();
      i = close + 1;
    } else if (ch === '/' && (s.regex || s.command === 'parse')) {
      // In parse, a slash after the field starts the pattern.
      const close = closingIndex(line, i + 1, '/');
      const end = close < 0 ? line.length : close + 1 + (/^[a-z]*/i.exec(line.slice(close + 1))?.[0].length ?? 0);
      push('regex', i, end, close < 0 ? { open: true } : {});
      afterValue();
      i = end;
    } else if (/[@A-Za-z_$`]/.test(ch)) {
      // A name, with `quoted parts` for special characters: @`aws.tag.a:b`, json.`user.id`.
      let end = i;
      let open = false;
      while (end < line.length && /[\w.@$`]/.test(line[end])) {
        if (line[end] === '`') {
          const close = closingIndex(line, end + 1, '`');
          if (close < 0) {
            open = true;
            end = line.length;
            break;
          }
          end = close + 1;
        } else {
          end++;
        }
      }
      const text = line.slice(i, end);
      const role: WordRole =
        s.expect === 'command' || (s.expect === 'subquery' && findCommand(text))
          ? 'command'
          : isKeyword(text)
            ? 'keyword'
            : 'field';
      push('word', i, end, { role, ...(open ? { open } : {}) });
      if (role === 'command') {
        s.command = text.toLowerCase();
        s.commandDepth = s.outer.length;
        s.regex = true;
        s.expect = 'any';
      } else if (role === 'keyword') {
        // like /x/; asc and desc end a sort key instead.
        s.regex = !['asc', 'desc'].includes(text.toLowerCase());
        s.expect = 'any';
      } else {
        afterValue();
      }
      i = end;
    } else if (/\d/.test(ch)) {
      const end = i + /^\d[\w.]*/.exec(rest)![0].length;
      push('number', i, end);
      afterValue();
      i = end;
    } else if (ch === '|' && line[i + 1] !== '|') {
      push('pipe', i, i + 1);
      s.expect = 'command';
      s.regex = true;
      s.command = undefined;
      s.commandDepth = s.outer.length;
      i++;
    } else if (ch === ',') {
      push('comma', i, i + 1);
      s.regex = true;
      s.expect = 'any';
      i++;
    } else if (ch === '(' || ch === '[') {
      const prev = tokens[tokens.length - 1];
      // name( is a call and name[ an index; otherwise a bracket may hold a subquery.
      const call = !spaced && prev?.type === 'word' && prev.role === 'field';
      if (call && ch === '(') {
        prev.role = 'function';
      }
      push('open', i, i + 1);
      s.outer.push([s.command, s.commandDepth]);
      s.expect = call || ch === '[' ? 'any' : 'subquery';
      s.regex = true;
      i++;
    } else if (ch === ')' || ch === ']') {
      push('close', i, i + 1);
      const outer = s.outer.pop();
      if (outer) {
        [s.command, s.commandDepth] = outer;
      }
      afterValue();
      i++;
    } else {
      // A slash here divides; it is never part of a longer operator, so =~/x/ stays a regex.
      const end = i + (/^(\|\||[=<>!~+\-*%^:&]+)/.exec(rest)?.[0].length ?? 1);
      push('operator', i, end);
      s.regex = true;
      s.expect = 'any';
      i = end;
    }
  }
  return { tokens, state: s };
}

/**
 * Index of the quote that closes a string, regex or backtick name, searching from `from`; escaped
 * characters are skipped, and so are character classes in a regex ([/] does not end it). -1 if the
 * line has none.
 */
function closingIndex(line: string, from: number, quote: string): number {
  let inClass = false;
  for (let i = from; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') {
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

export interface Token {
  type: TokenType;
  role?: WordRole;
  text: string;
  /** Lines and columns from 1, the way Monaco counts; the end column is exclusive. */
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  /** Offsets in the query; the end is exclusive. */
  offset: number;
  endOffset: number;
  spaced: boolean;
  /** Not closed: a string at the end of the query, a regex or backtick at the end of its line. */
  open?: boolean;
}

/** Tokens of a whole query, comments included, and the state at its end. */
export function tokenize(query: string): { tokens: Token[]; state: LexState } {
  const tokens: Token[] = [];
  let state = INITIAL_STATE;
  let offset = 0;
  query.split('\n').forEach((text, l) => {
    const result = tokenizeLine(text, state);
    for (const t of result.tokens) {
      const line = l + 1;
      const last = tokens[tokens.length - 1];
      if (t.continued && last?.type === 'string') {
        // The rest of a string from the line above.
        last.text += `\n${t.text}`;
        last.endLine = line;
        last.endColumn = t.end + 1;
        last.endOffset = offset + t.end;
        last.open = t.open;
        continue;
      }
      tokens.push({
        type: t.type,
        ...(t.role ? { role: t.role } : {}),
        text: t.text,
        line,
        column: t.start + 1,
        endLine: line,
        endColumn: t.end + 1,
        offset: offset + t.start,
        endOffset: offset + t.end,
        spaced: t.spaced,
        ...(t.open ? { open: true } : {}),
      });
    }
    state = result.state;
    offset += text.length + 1;
  });
  return { tokens, state };
}
