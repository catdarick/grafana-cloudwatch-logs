import type { Monaco, monacoTypes } from '@grafana/ui';

export const LANGUAGE_ID = 'cloudwatch-logs-insights';

export const COMMANDS = [
  'fields',
  'display',
  'filter',
  'stats',
  'sort',
  'limit',
  'parse',
  'dedup',
  'pattern',
  'diff',
  'unmask',
  'anomaly',
  'filterIndex',
  'source',
];

export const KEYWORDS = [
  'by',
  'as',
  'asc',
  'desc',
  'like',
  'not',
  'and',
  'or',
  'in',
  'ispresent',
  'isempty',
  'isblank',
];

export const FUNCTIONS = [
  // aggregations
  'avg',
  'count',
  'count_distinct',
  'max',
  'min',
  'pct',
  'stddev',
  'sum',
  'earliest',
  'latest',
  'sortsFirst',
  'sortsLast',
  // non-aggregations
  'bin',
  'datefloor',
  'dateceil',
  'fromMillis',
  'toMillis',
  'now',
  'abs',
  'ceil',
  'floor',
  'greatest',
  'least',
  'log',
  'sqrt',
  'concat',
  'ltrim',
  'rtrim',
  'trim',
  'strlen',
  'toupper',
  'tolower',
  'substr',
  'replace',
  'strcontains',
  'isValidIp',
  'isValidIpV4',
  'isValidIpV6',
  'isIpInSubnet',
  'isIpv4InSubnet',
  'isIpv6InSubnet',
  'coalesce',
  'jsonParse',
  'unnest',
];

export const SYSTEM_FIELDS = [
  '@timestamp',
  '@message',
  '@logStream',
  '@log',
  '@ingestionTime',
  '@ptr',
  '@requestId',
  '@duration',
];

const monarch: monacoTypes.languages.IMonarchLanguage = {
  ignoreCase: true,
  defaultToken: '',
  commands: COMMANDS,
  keywords: KEYWORDS,
  functions: FUNCTIONS,
  tokenizer: {
    root: [
      [/#.*$/, 'comment'],
      [/@[\w.$]+/, 'variable.predefined'],
      [/'([^'\\]|\\.)*'/, 'string'],
      [/"([^"\\]|\\.)*"/, 'string'],
      [/`([^`\\]|\\.)*`/, 'variable'],
      [/\/(?:[^/\\\n]|\\.)+\/[a-z]*/, 'regexp'],
      [/\d+(\.\d+)?(ms|s|m|h|d|w|mo|q|y)?\b/, 'number'],
      [/[a-zA-Z_][\w.]*(?=\s*\()/, { cases: { '@functions': 'type', '@default': 'identifier' } }],
      [
        /[a-zA-Z_][\w.]*/,
        { cases: { '@commands': 'keyword', '@keywords': 'keyword.operator', '@default': 'identifier' } },
      ],
      [/\|/, 'delimiter'],
      [/[=<>!~+\-*/%^]+/, 'operator'],
      [/[,()[\]]/, 'delimiter'],
    ],
  },
};

let registered = false;

/** Registers the Logs Insights grammar once per page; Monaco keeps languages globally. */
export function registerLogsInsights(monaco: Monaco) {
  if (registered || monaco.languages.getLanguages().some((l) => l.id === LANGUAGE_ID)) {
    registered = true;
    return;
  }
  monaco.languages.register({ id: LANGUAGE_ID });
  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, monarch);
  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, {
    comments: { lineComment: '#' },
    brackets: [['(', ')']],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: "'", close: "'", notIn: ['string'] },
      { open: '"', close: '"', notIn: ['string'] },
    ],
  });
  registered = true;
}
