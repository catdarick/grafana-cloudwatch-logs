import { lintQuery } from './lint';

const messages = (query: string) => lintQuery(query).map((p) => `${p.line}:${p.column} ${p.message}`);

describe('lintQuery', () => {
  it('passes valid queries', () => {
    const queries = [
      'fields @timestamp, @message\n| sort @timestamp desc\n| limit 100',
      'filter @message like /error|warn/i\n| stats count(*) as n by bin(5m)\n| sort n desc',
      'parse @message /(?<user>\\S+) did (?<what>.*)/ | display user, what',
      "parse @message 'user=* action=*' as user, action",
      'filter status >= 500 and ispresent(requestId) and level in ["error", "fatal"]',
      'fields a / 2 as half, (b + c) / d as ratio | sort half',
      'fields `my-field` | sort `my-field` asc, x',
      "fields x # trailing comment with | pipe and 'quote'\n# | filter whole line commented out",
      'filter @message =~ /a\\/b/ | sort count(*) desc',
      '',
    ];
    for (const q of queries) {
      expect(messages(q)).toEqual([]);
    }
  });

  it('flags a sort direction typo', () => {
    expect(messages('fields a\n| sort @timestamp desc, timestamp_internal ascs')).toEqual([
      '2:44 Expected asc or desc, found "ascs". Did you mean "asc"?',
    ]);
  });

  it('flags unknown commands with a suggestion', () => {
    expect(messages('fields a | fitler a = 1')).toEqual(['1:12 Unknown command "fitler". Did you mean "filter"?']);
    expect(messages('fields a | 42')[0]).toMatch(/^1:12 Unknown command "42". Expected one of: fields, /);
  });

  it('flags empty stages and commands without arguments', () => {
    expect(messages('fields a |')).toEqual(['1:10 Expected a command after |']);
    expect(messages('fields a | | limit 5')).toEqual(['1:10 Expected a command after |']);
    expect(messages('fields a | sort')).toEqual(['1:12 "sort" needs arguments']);
  });

  it('flags unclosed quotes, regexes and brackets', () => {
    expect(messages("filter a = 'x")).toEqual(["1:12 Unclosed quote: ' has no matching ' on this line"]);
    expect(messages('filter a like /x')).toEqual(['1:15 Unclosed regex: / has no matching / on this line']);
    expect(messages('stats count(* by x')).toEqual(['1:12 Unclosed (']);
    expect(messages('fields a)')).toEqual(['1:9 Unexpected ): there is no ( for it to close']);
  });

  it('flags a bad limit', () => {
    expect(messages('fields a | limit 0')).toEqual(['1:18 limit must be a whole number from 1 to 10000']);
    expect(messages('fields a | limit 20000')).toEqual(['1:18 limit must be a whole number from 1 to 10000']);
    expect(messages('fields a | limit 10 20')).toEqual(['1:21 limit takes a single number']);
  });
});
