import { describeTimeRange, isValidRange, toEpochRange } from './timeRange';

describe('timeRange', () => {
  it('converts relative ranges to epoch millis', () => {
    const now = Date.UTC(2026, 9, 9, 12, 0, 0);
    expect(toEpochRange({ mode: 'relative', amount: 30, unit: 'hours' }, now)).toEqual({
      from: now - 30 * 60 * 60 * 1000,
      to: now,
    });
    expect(toEpochRange({ mode: 'relative', amount: 7, unit: 'days' }, now).from).toBe(now - 7 * 86400000);
  });

  it('passes absolute ranges through', () => {
    expect(toEpochRange({ mode: 'absolute', from: 1, to: 2 })).toEqual({ from: 1, to: 2 });
  });

  it('describes relative ranges', () => {
    expect(describeTimeRange({ mode: 'relative', amount: 1, unit: 'hours' }, 'utc')).toBe('Last 1 hour');
    expect(describeTimeRange({ mode: 'relative', amount: 15, unit: 'minutes' }, 'utc')).toBe('Last 15 minutes');
  });

  it('describes absolute ranges in the chosen zone', () => {
    const from = Date.UTC(2026, 9, 8, 10, 0, 0);
    const to = Date.UTC(2026, 9, 8, 12, 0, 0);
    expect(describeTimeRange({ mode: 'absolute', from, to }, 'utc')).toBe(
      '2026-10-08 10:00:00 → 2026-10-08 12:00:00 UTC'
    );
  });

  it('validates ranges', () => {
    expect(isValidRange({ mode: 'relative', amount: 0, unit: 'days' })).toBe(false);
    expect(isValidRange({ mode: 'absolute', from: 5, to: 1 })).toBe(false);
    expect(isValidRange({ mode: 'absolute', from: 1, to: 5 })).toBe(true);
  });
});
