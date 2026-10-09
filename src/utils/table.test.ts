import { Row, fullLog, moveColumn, orderColumns, splitMatches, valueCounts, visibleColumns } from './table';

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
