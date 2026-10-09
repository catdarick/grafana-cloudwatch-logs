import { parseRangeInput, parseTimeInput } from './parseTime';

const utc = (s: string) => Date.parse(s);

describe('parseTimeInput', () => {
  it.each([
    ['2026-10-08T22:59:45.4267317Z', utc('2026-10-08T22:59:45.426Z')],
    ['2026-10-08T22:59:45Z', utc('2026-10-08T22:59:45Z')],
    ['2026-10-08 22:59:45', utc('2026-10-08T22:59:45Z')],
    ['2026-10-08 22:59', utc('2026-10-08T22:59:00Z')],
    ['2026-10-08', utc('2026-10-08T00:00:00Z')],
    ['2026/10/08 22:59:45', utc('2026-10-08T22:59:45Z')],
    ['2026-10-08T22:59:45+03:00', utc('2026-10-08T19:59:45Z')],
    ['2026-10-08 22:59:45 UTC', utc('2026-10-08T22:59:45Z')],
    ['08.10.2026 22:59:45', utc('2026-10-08T22:59:45Z')],
    ['08.10.2026, 22:59', utc('2026-10-08T22:59:00Z')],
    ['1791500385', 1791500385000],
    ['1791500385123', 1791500385123],
    ['1791500385123456', 1791500385123],
    ['1791500385123456789', 1791500385123],
    ['"2026-10-08 22:59:45"', utc('2026-10-08T22:59:45Z')],
    ['Thu, 08 Oct 2026 22:59:45 GMT', utc('2026-10-08T22:59:45Z')],
    ['Oct 8, 2026 10:59:45 PM', utc('2026-10-08T22:59:45Z')],
  ])('parses %s as UTC', (input, expected) => {
    expect(parseTimeInput(input, 'utc')).toBe(expected);
  });

  it('reads zone-less text in the chosen time zone', () => {
    expect(parseTimeInput('2026-10-08 22:59:45', 'Europe/Moscow')).toBe(utc('2026-10-08T19:59:45Z'));
    expect(parseTimeInput('2026-10-08T22:59:45Z', 'Europe/Moscow')).toBe(utc('2026-10-08T22:59:45Z'));
  });

  it('understands relative expressions', () => {
    const now = Date.now();
    const value = parseTimeInput('now-1h', 'utc')!;
    expect(Math.abs(value - (now - 3600_000))).toBeLessThan(5000);
  });

  it('rejects garbage', () => {
    expect(parseTimeInput('yesterday-ish', 'utc')).toBeUndefined();
    expect(parseTimeInput('2026-13-40 10:00', 'utc')).toBeUndefined();
    expect(parseTimeInput('', 'utc')).toBeUndefined();
  });
});

describe('parseRangeInput', () => {
  it('splits pasted ranges', () => {
    expect(parseRangeInput('2026-10-08 10:00 - 2026-10-08 12:00', 'utc')).toEqual({
      from: utc('2026-10-08T10:00:00Z'),
      to: utc('2026-10-08T12:00:00Z'),
    });
    expect(parseRangeInput('2026-10-08T10:00:00Z to 2026-10-08T12:00:00Z', 'utc')).toBeDefined();
  });

  it('ignores single timestamps', () => {
    expect(parseRangeInput('2026-10-08 10:00', 'utc')).toBeUndefined();
  });
});
