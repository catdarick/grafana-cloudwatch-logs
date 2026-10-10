import { addQueryStage, mentionsField, parseQuery, queryStageLine, sortKeys } from './parse';

describe('parseQuery', () => {
  it('splits stages at pipes, not at pipes in brackets, strings, regexes or comments', () => {
    const { stages } = parseQuery("fields a # | sort b\n| filter m like /x|y/ or s = '|'\n| limit 5");
    expect(stages.map((s) => s.command?.name)).toEqual(['fields', 'filter', 'limit']);
  });

  it('parses subqueries as stages of their own', () => {
    const { stages } = parseQuery("filter id in (SOURCE 'g' | filter e = 1 | fields id)\n| fields id");
    expect(stages.map((s) => s.command?.name)).toEqual(['filter', 'fields']);
    expect(stages[0].subqueries.map((sub) => sub.map((s) => s.command?.name))).toEqual([
      ['SOURCE', 'filter', 'fields'],
    ]);
  });

  it('knows commands in any case and leaves unknown ones without a spec', () => {
    const { stages } = parseQuery('STATS count(*) | hfbvf x');
    expect(stages.map((s) => [s.head?.text, s.command?.name])).toEqual([
      ['STATS', 'stats'],
      ['hfbvf', undefined],
    ]);
  });
});

describe('sortKeys', () => {
  it('reads the last sort command', () => {
    expect(sortKeys('fields a | sort @timestamp desc | limit 5')).toEqual([{ field: '@timestamp', desc: true }]);
    expect(sortKeys('stats count(*) as n by x\n| sort n desc, x')).toEqual([
      { field: 'n', desc: true },
      { field: 'x', desc: false },
    ]);
    expect(sortKeys('fields a | limit 5')).toEqual([]);
  });

  it('ignores a sort that is commented out', () => {
    expect(sortKeys('fields a\n| sort a asc\n# | sort b desc')).toEqual([{ field: 'a', desc: false }]);
  });

  it('reads a sort that starts the query, in any case, with quoted names', () => {
    expect(sortKeys('SORT `my-field` DESC')).toEqual([{ field: 'my-field', desc: true }]);
  });

  it('stops at a key that is an expression', () => {
    expect(sortKeys('sort a desc, strlen(b) asc, c')).toEqual([{ field: 'a', desc: true }]);
  });
});

describe('addQueryStage', () => {
  it('inserts the clause before sort and limit', () => {
    expect(addQueryStage('fields a\n| sort @timestamp desc\n| limit 20', 'filter a = 1')).toBe(
      'fields a\n| filter a = 1\n| sort @timestamp desc\n| limit 20'
    );
    expect(addQueryStage('fields a, b | limit 50', 'filter a = 1')).toBe('fields a, b\n| filter a = 1\n| limit 50');
    expect(addQueryStage('fields a', 'filter a = 1')).toBe('fields a\n| filter a = 1');
  });

  it('inserts it before stats that starts the query, and sees commands in any case', () => {
    expect(addQueryStage('stats count(*) by x', 'filter a = 1')).toBe('filter a = 1\n| stats count(*) by x');
    expect(addQueryStage('fields a\n| SORT a', 'filter a = 1')).toBe('fields a\n| filter a = 1\n| SORT a');
  });

  it('is not misled by a commented-out sort', () => {
    expect(addQueryStage('fields a\n# | sort a\n| filter b', 'filter a = 1')).toBe(
      'fields a\n# | sort a\n| filter b\n| filter a = 1'
    );
  });
});

describe('queryStageLine', () => {
  it('points at the line before a sort that starts its own line', () => {
    expect(queryStageLine('fields a\n| filter b = 1\n| sort @timestamp desc\n| limit 5')).toBe(2);
  });
  it('points at the line holding a mid-line sort', () => {
    expect(queryStageLine('fields a | sort @timestamp desc | limit 5\n\n')).toBe(1);
  });
  it('falls back to the last line with text', () => {
    expect(queryStageLine('fields a\n| filter b = 1\n\n\n')).toBe(2);
  });
  it('points before the first line when the query starts with stats', () => {
    expect(queryStageLine('stats count(*)')).toBe(0);
  });
});

describe('mentionsField', () => {
  it('finds a field outside comments and strings', () => {
    expect(mentionsField('fields @timestamp, a', '@timestamp')).toBe(true);
    expect(mentionsField("fields a # @timestamp\n| filter b = '@timestamp'", '@timestamp')).toBe(false);
  });
});
