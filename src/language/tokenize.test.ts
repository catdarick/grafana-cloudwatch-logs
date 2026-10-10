import { tokenScope } from './logsInsights';
import { INITIAL_STATE, LineToken, tokenize, tokenizeLine } from './tokenize';

/** "text:type/role" of each token, comments included. */
const read = (query: string) => tokenize(query).tokens.map((t) => `${t.text}:${t.role ?? t.type}${t.open ? '!' : ''}`);

/** Tokens the way Monaco gets them: line by line, each from the state the line above ended in. */
function byLine(query: string): LineToken[][] {
  let state = INITIAL_STATE;
  return query.split('\n').map((line) => {
    const result = tokenizeLine(line, state);
    state = result.state;
    return result.tokens;
  });
}

describe('tokenize', () => {
  it('tells commands, keywords, functions and fields apart by position', () => {
    expect(read('fields count, count(x) as n | stats count(*) by bin(5m)')).toEqual([
      'fields:command',
      'count:field',
      ',:comma',
      'count:function',
      '(:open',
      'x:field',
      '):close',
      'as:keyword',
      'n:field',
      '|:pipe',
      'stats:command',
      'count:function',
      '(:open',
      '*:operator',
      '):close',
      'by:keyword',
      'bin:function',
      '(:open',
      '5m:number',
      '):close',
    ]);
  });

  it('takes the first word of a stage as its command, known or not', () => {
    expect(read('source | fitler x')).toEqual(['source:command', '|:pipe', 'fitler:command', 'x:field']);
    // A field named like a command is still a field.
    expect(read('fields join, source')).toEqual(['fields:command', 'join:field', ',:comma', 'source:field']);
  });

  it('reads a slash as a regex where a division cannot be', () => {
    expect(read('fields a / 2 / b')).toEqual([
      'fields:command',
      'a:field',
      '/:operator',
      '2:number',
      '/:operator',
      'b:field',
    ]);
    expect(read('filter m like /a|b/i | filter x =~ /c/')).toEqual([
      'filter:command',
      'm:field',
      'like:keyword',
      '/a|b/i:regex',
      '|:pipe',
      'filter:command',
      'x:field',
      '=~:operator',
      '/c/:regex',
    ]);
    expect(read('parse @message /(?<a>\\S+) [/]x/ as a')[2]).toBe('/(?<a>\\S+) [/]x/:regex');
  });

  it('keeps quoted parts in names', () => {
    expect(read('filter @`aws.tag.a:b` = 1 | fields json.`user.id`')).toEqual([
      'filter:command',
      '@`aws.tag.a:b`:field',
      '=:operator',
      '1:number',
      '|:pipe',
      'fields:command',
      'json.`user.id`:field',
    ]);
  });

  it('sees subqueries: a bracket whose first word is a command', () => {
    expect(read("filter id in (SOURCE 'g' | fields id)")).toEqual([
      'filter:command',
      'id:field',
      'in:keyword',
      '(:open',
      'SOURCE:command',
      "'g':string",
      '|:pipe',
      'fields:command',
      'id:field',
      '):close',
    ]);
    // A bracket of an expression is not a subquery.
    expect(read('fields (a + b) as c')[2]).toBe('a:field');
  });

  it('carries strings over lines and marks what is left open', () => {
    expect(read("filter a = 'x\ny' | fields b")).toEqual([
      'filter:command',
      'a:field',
      '=:operator',
      "'x\ny':string",
      '|:pipe',
      'fields:command',
      'b:field',
    ]);
    expect(read("filter a = 'x")).toEqual(['filter:command', 'a:field', '=:operator', "'x:string!"]);
    expect(read('filter a like /x')).toEqual(['filter:command', 'a:field', 'like:keyword', '/x:regex!']);
  });

  it('keeps comments out of the query', () => {
    expect(read("fields a # | sort 'x\n| limit 5")).toEqual([
      'fields:command',
      'a:field',
      "# | sort 'x:comment",
      '|:pipe',
      'limit:command',
      '5:number',
    ]);
  });

  // Highlighting reads line by line; the checker reads the whole query. They must agree.
  it.each([
    'fields a, b\n| filter c like /x|y/\n| sort a desc\n| limit 10',
    "filter a = 'multi\nline' and b = 1\n| fields c",
    "filter id in (\n  SOURCE 'g'\n  | fields id\n)\n| stats count(*) by bin(5m)",
    'parse @message\n  /(?<a>\\S+)/ as a\n| display a',
    'fields x\n# | sort y\n| dedup x',
  ])('reads %p the same line by line as whole', (query) => {
    const whole = tokenize(query).tokens.filter((t) => t.line === t.endLine);
    const lines = byLine(query)
      .flatMap((tokens, i) => tokens.map((t) => ({ ...t, line: i + 1 })))
      .filter((t) => !t.continued && !(t.type === 'string' && t.open));
    expect(lines.map((t) => [t.line, t.start + 1, t.type, t.role])).toEqual(
      whole.map((t) => [t.line, t.column, t.type, t.role])
    );
  });
});

describe('tokenScope', () => {
  const scopes = (line: string) => tokenizeLine(line, INITIAL_STATE).tokens.map((t) => `${t.text}:${tokenScope(t)}`);

  it('colours known commands and functions, and leaves unknown ones plain', () => {
    expect(scopes('stats count(x) by y | hfbvf z | fields mystery(a), @timestamp')).toEqual([
      'stats:keyword',
      'count:type',
      '(:delimiter',
      'x:identifier',
      '):delimiter',
      'by:keyword.operator',
      'y:identifier',
      '|:delimiter',
      'hfbvf:identifier',
      'z:identifier',
      '|:delimiter',
      'fields:keyword',
      'mystery:identifier',
      '(:delimiter',
      'a:identifier',
      '):delimiter',
      ',:delimiter',
      '@timestamp:variable.predefined',
    ]);
  });
});
