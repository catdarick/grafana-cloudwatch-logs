import {
  Row,
  estimateWidth,
  flattenJson,
  flattenMessage,
  fullLog,
  histogram,
  isMonoColumn,
  moveColumn,
  orderColumns,
  queryFilter,
  searchClause,
  sortOrder,
  unloadedRange,
  valueFilterClause,
  splitMatches,
  valueCounts,
  visibleColumns,
} from './table';

describe('table utils', () => {
  it('keeps the remembered column order and appends new fields', () => {
    expect(orderColumns(['a', 'b', 'c'], { order: ['c', 'gone', 'a'] })).toEqual(['c', 'a', 'b']);
    expect(visibleColumns(['a', 'b', 'c'], { order: ['c'], hidden: ['a'] })).toEqual(['c', 'b']);
  });

  it('moves a column and ignores moves past the edges', () => {
    expect(moveColumn(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
    expect(moveColumn(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
  });

  it('counts values over rows that pass the other columns filters', () => {
    const rows: Row[] = [
      { severity: 'Info', endpoint: '/a' },
      { severity: 'Info', endpoint: '/b' },
      { severity: 'Debug', endpoint: '/a' },
      { endpoint: '/a' },
    ];
    expect(valueCounts(rows, 'severity', {})).toEqual([
      { value: 'Info', count: 2 },
      { value: '', count: 1 },
      { value: 'Debug', count: 1 },
    ]);
    // Its own filter does not hide values from the list; the endpoint filter does change counts.
    expect(valueCounts(rows, 'severity', { severity: new Set(['Info']), endpoint: new Set(['/b']) })).toEqual([
      { value: 'Info', count: 1 },
      { value: '', count: 0 },
      { value: 'Debug', count: 0 },
    ]);
  });

  it('splits text around case-insensitive matches', () => {
    expect(splitMatches('Charging USER-1 and user-2', 'user')).toEqual([
      { text: 'Charging ', match: false },
      { text: 'USER', match: true },
      { text: '-1 and ', match: false },
      { text: 'user', match: true },
      { text: '-2', match: false },
    ]);
  });

  it('shows the parsed message as the full log, or falls back to the row', () => {
    const row = { severity: 'Info' };
    expect(fullLog(row, { message: '{"severity":"Info","userId":"42"}' })).toEqual({
      severity: 'Info',
      userId: '42',
    });
    expect(fullLog(row, { message: 'plain text' })).toEqual({ severity: 'Info', '@message': 'plain text' });
    expect(fullLog(row, undefined)).toEqual(row);
  });
});

describe('query helpers', () => {
  it('builds filter clauses', () => {
    expect(queryFilter('severity', 'Info', false)).toBe('filter severity = "Info"');
    expect(queryFilter('kubernetes.pod_name', 'a"b', true)).toBe('filter kubernetes.pod_name != "a\\"b"');
    expect(queryFilter('status code', 200, false)).toBe('filter `status code` = 200');
    expect(queryFilter('x', null, false)).toBe('filter isempty(x)');
  });

  it('quotes field names the way the documentation requires', () => {
    expect(queryFilter('request-id', 'x', false)).toBe('filter `request-id` = "x"');
    expect(queryFilter('@aws.tag.a:b', 'x', false)).toBe('filter @`aws.tag.a:b` = "x"');
  });
});

describe('column heuristics', () => {
  it('spots id-like and numeric columns', () => {
    expect(isMonoColumn(['6441', '6442', ''])).toBe(true);
    expect(isMonoColumn(['d61a2133-626b-4e26-8da8-b98d7535681a'])).toBe(true);
    expect(isMonoColumn(['2026-10-09T20:27:36.059563355Z'])).toBe(true);
    expect(isMonoColumn(['Info', 'Debug'])).toBe(false);
  });

  it('sizes columns from their content within limits', () => {
    expect(estimateWidth('userId', ['6441'])).toBe(92);
    expect(estimateWidth('message', ['x'.repeat(500)])).toBe(420);
  });
});

describe('histogram', () => {
  it('counts points per bin and group', () => {
    const bins = histogram(
      [
        { time: 0, group: 'info' },
        { time: 5, group: 'error' },
        { time: 10, group: 'info' },
      ],
      0,
      10,
      2
    );
    expect(bins.map((b) => b.total)).toEqual([1, 2]);
    expect(bins[1].counts).toEqual({ error: 1, info: 1 });
  });
});

describe('sorting', () => {
  it('orders numbers numerically and puts missing values last', () => {
    const values = ['10', '9', undefined, '100'];
    expect(sortOrder(4, [{ field: 'n', desc: true }], (i) => values[i])).toEqual([3, 0, 1, 2]);
    expect(sortOrder(4, [{ field: 'n', desc: false }], (i) => values[i])).toEqual([1, 0, 3, 2]);
  });
});

describe('unloadedRange', () => {
  const desc = [{ field: '@timestamp', desc: true }];
  it('puts the cut-off logs before the oldest loaded row for newest-first queries', () => {
    expect(unloadedRange([50, 60, 70], 0, 100, desc, 1000)).toEqual({ from: 0, to: 50, count: 997 });
  });
  it('puts them after the newest row for oldest-first queries', () => {
    expect(unloadedRange([10, 20], 0, 100, [{ field: '@timestamp', desc: false }], 5)).toEqual({
      from: 20,
      to: 100,
      count: 3,
    });
  });
  it('knows nothing when everything was loaded or rows are sorted by something else', () => {
    expect(unloadedRange([10, 20], 0, 100, desc, 2)).toBeUndefined();
    expect(unloadedRange([10, 20], 0, 100, [{ field: 'n', desc: true }], 50)).toBeUndefined();
  });
});

describe('flattenJson', () => {
  it('names nested leaves by dotted path and skips empty values', () => {
    expect(flattenJson({ a: 1, b: { c: 'x', d: null }, items: [{ id: 7 }, true], e: '' })).toEqual({
      a: '1',
      'b.c': 'x',
      'items.0.id': '7',
      'items.1': 'true',
    });
  });

  it('reads only JSON object messages', () => {
    expect(flattenMessage('{"level":"info"}')).toEqual({ level: 'info' });
    expect(flattenMessage('plain text')).toEqual({});
    expect(flattenMessage('{broken')).toEqual({});
  });
});

describe('filter clauses', () => {
  const all = ['Info', 'Debug', 'Warning', 'Error', ''];
  it('uses = and in for a few allowed values', () => {
    expect(valueFilterClause('severity', new Set(['Error']), all, false)).toBe('filter severity = "Error"');
    expect(valueFilterClause('severity', new Set(['Error', 'Warning']), all, false)).toBe(
      'filter severity in ["Error", "Warning"]'
    );
  });

  it('uses != and not in when fewer values are excluded', () => {
    expect(valueFilterClause('severity', new Set(['Info', 'Warning', 'Error', '']), all, false)).toBe(
      'filter severity != "Debug" or isempty(severity)'
    );
    expect(
      valueFilterClause('severity', new Set(['Info', 'Warning', 'Error']), ['Info', 'Debug', 'Warning', 'Error'], false)
    ).toBe('filter severity != "Debug"');
    expect(valueFilterClause('severity', new Set(['Info', 'Debug', 'Warning']), all, false)).toBe(
      'filter severity != "Error" and ispresent(severity)'
    );
  });

  it('writes numbers without quotes and quotes odd field names', () => {
    expect(valueFilterClause('status code', new Set(['500']), ['200', '500', '404'], true)).toBe(
      'filter `status code` = 500'
    );
  });

  it('turns search into a case-insensitive regex', () => {
    expect(searchClause('a.b/c', ['message', 'pod'])).toBe(
      'filter message like /(?i)a\\.b\\/c/ or pod like /(?i)a\\.b\\/c/'
    );
  });
});
