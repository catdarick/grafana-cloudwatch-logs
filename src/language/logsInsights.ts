import type { Monaco, monacoTypes } from '@grafana/ui';
import { getCompletions } from './completion';
import { findCommand, findFunction } from './spec';
import { INITIAL_STATE, LexState, LineToken, cloneState, sameState, tokenizeLine } from './tokenize';

export const LANGUAGE_ID = 'cloudwatch-logs-insights';

/** Theme scope of a token: the same names Monarch grammars use, so the theme colours them. */
export function tokenScope(t: LineToken): string {
  switch (t.type) {
    case 'comment':
      return 'comment';
    case 'string':
      return 'string';
    case 'regex':
      return 'regexp';
    case 'number':
      return 'number';
    case 'operator':
      return 'operator';
    case 'word':
      if (t.text.startsWith('@')) {
        return 'variable.predefined';
      }
      if (t.role === 'command') {
        // An unknown word in command position is underlined by the checker, not coloured as one.
        return findCommand(t.text) ? 'keyword' : 'identifier';
      }
      if (t.role === 'keyword') {
        return 'keyword.operator';
      }
      if (t.role === 'function') {
        return findFunction(t.text) ? 'type' : 'identifier';
      }
      return t.text.includes('`') ? 'variable' : 'identifier';
    default:
      return 'delimiter';
  }
}

class State implements monacoTypes.languages.IState {
  constructor(readonly lex: LexState) {}
  clone() {
    return new State(cloneState(this.lex));
  }
  equals(other: monacoTypes.languages.IState) {
    return other instanceof State && sameState(this.lex, other.lex);
  }
}

// Field names for autocomplete, per editor model: the provider is registered once for the language.
const modelFields = new WeakMap<monacoTypes.editor.ITextModel, () => string[]>();

/** Lets autocomplete in this model offer these fields; returns a function that stops it. */
export function setModelFields(model: monacoTypes.editor.ITextModel, getFields: () => string[]): () => void {
  modelFields.set(model, getFields);
  return () => modelFields.delete(model);
}

let registered = false;

/**
 * Registers the language once per page (Monaco keeps languages globally): highlighting and
 * autocomplete both read queries with the tokenizer the checker uses, so they agree on what is a
 * command, a field or a string.
 */
export function registerLogsInsights(monaco: Monaco) {
  if (registered) {
    return;
  }
  registered = true;
  if (!monaco.languages.getLanguages().some((l) => l.id === LANGUAGE_ID)) {
    monaco.languages.register({ id: LANGUAGE_ID });
  }
  monaco.languages.setTokensProvider(LANGUAGE_ID, {
    getInitialState: () => new State(INITIAL_STATE),
    tokenize: (line, state) => {
      const result = tokenizeLine(line, (state as State).lex);
      return {
        tokens: result.tokens.map((t) => ({ startIndex: t.start, scopes: tokenScope(t) })),
        endState: new State(result.state),
      };
    },
  });
  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, {
    comments: { lineComment: '#' },
    brackets: [
      ['(', ')'],
      ['[', ']'],
    ],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: "'", close: "'", notIn: ['string'] },
      { open: '"', close: '"', notIn: ['string'] },
      { open: '`', close: '`', notIn: ['string'] },
    ],
  });

  const kinds = monaco.languages.CompletionItemKind;
  const KIND = { command: kinds.Keyword, function: kinds.Function, field: kinds.Field, keyword: kinds.Operator };
  monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, {
    triggerCharacters: [' ', '|', '(', ',', '@', '`', '.'],
    provideCompletionItems: (model, position, context) => {
      const offset = model.getOffsetAt(position);
      const result = getCompletions(model.getValue(), offset, modelFields.get(model)?.() ?? []);
      // A space only opens the list where it is the natural next step: a command, a sort direction.
      const bySpace = context.triggerCharacter === ' ';
      if (!result || (bySpace && result.context !== 'command' && result.context !== 'sortDirection')) {
        return { suggestions: [] };
      }
      const start = model.getPositionAt(result.from);
      const range = {
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      };
      return {
        suggestions: result.items.map((item) => ({
          label: item.label,
          kind: KIND[item.kind],
          insertText: item.insertText,
          insertTextRules: item.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
          filterText: item.filterText,
          detail: item.detail,
          documentation: item.documentation,
          sortText: item.sortText,
          range,
        })),
      };
    },
  });
}
