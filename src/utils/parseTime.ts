import { dateMath, dateTimeForTimeZone } from '@grafana/data';
import type { TimeZone } from '@grafana/schema';

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Wall-clock time in `timeZone` → epoch millis. */
function wallClock(
  timeZone: TimeZone,
  y: number,
  mo: number,
  d: number,
  h = 0,
  mi = 0,
  s = 0,
  ms = 0
): number | undefined {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) {
    return undefined;
  }
  const text = `${pad(y, 4)}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}.${pad(ms, 3)}`;
  const value = dateTimeForTimeZone(timeZone, text, 'YYYY-MM-DD HH:mm:ss.SSS');
  return value.isValid() ? value.valueOf() : undefined;
}

function offsetMinutes(zone: string): number | undefined {
  if (/^(z|utc|gmt)$/i.test(zone)) {
    return 0;
  }
  const m = /^([+-])(\d{2}):?(\d{2})?$/.exec(zone);
  if (!m) {
    return undefined;
  }
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '-' ? -minutes : minutes;
}

// 2026-10-08T22:59:45.4267317Z, 2026-10-08 22:59, 2026/10/08 22:59:45 +03:00, 2026-10-08
const ISO =
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?\s*(Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?)?$/i;
// 08.10.2026 22:59:45 (day first, as written in Russian locale)
const DOTTED =
  /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?\s*(Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?)?$/i;

function fromParts(
  timeZone: TimeZone,
  y: number,
  mo: number,
  d: number,
  h?: string,
  mi?: string,
  s?: string,
  frac?: string,
  zone?: string
): number | undefined {
  const ms = frac ? Number(frac.slice(0, 3).padEnd(3, '0')) : 0;
  const args = [y, mo, d, Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0), ms] as const;
  if (zone) {
    const offset = offsetMinutes(zone);
    if (offset === undefined) {
      return undefined;
    }
    const utc = wallClock('utc', ...args);
    return utc === undefined ? undefined : utc - offset * 60_000;
  }
  return wallClock(timeZone, ...args);
}

/**
 * Parses a pasted timestamp. Text without an explicit offset is read as wall-clock time in `timeZone`.
 *
 * Accepts ISO 8601 (any fractional precision), "YYYY-MM-DD HH:mm[:ss]", "DD.MM.YYYY HH:mm[:ss]",
 * epoch seconds / millis / micros / nanos, Grafana relative expressions ("now-1h"), and anything
 * the browser's Date parser understands ("Oct 8, 2026 10:59 PM", RFC 2822).
 */
export function parseTimeInput(input: string, timeZone: TimeZone): number | undefined {
  const text = input.trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!text) {
    return undefined;
  }

  if (/^\d+(\.\d+)?$/.test(text)) {
    const digits = text.split('.')[0].length;
    const n = Number(text);
    if (digits <= 10) {
      return Math.round(n * 1000);
    }
    if (digits <= 13) {
      return Math.round(n);
    }
    if (digits <= 16) {
      return Math.round(n / 1000);
    }
    return Math.round(n / 1_000_000);
  }

  if (/^now/i.test(text)) {
    return dateMath.parse(text.toLowerCase(), false, timeZone)?.valueOf();
  }

  let m = ISO.exec(text);
  if (m) {
    return fromParts(timeZone, Number(m[1]), Number(m[2]), Number(m[3]), m[4], m[5], m[6], m[7], m[8]);
  }
  m = DOTTED.exec(text);
  if (m) {
    return fromParts(timeZone, Number(m[3]), Number(m[2]), Number(m[1]), m[4], m[5], m[6], m[7], m[8]);
  }

  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  if (/(\bZ|\bUTC|\bGMT|[+-]\d{2}:?\d{2})\s*$/i.test(text) || /\b(UTC|GMT)[+-]\d/i.test(text)) {
    return parsed;
  }
  // No zone in the text: Date read it as browser-local wall-clock time, so re-read those fields in `timeZone`.
  const local = new Date(parsed);
  return wallClock(
    timeZone,
    local.getFullYear(),
    local.getMonth() + 1,
    local.getDate(),
    local.getHours(),
    local.getMinutes(),
    local.getSeconds(),
    local.getMilliseconds()
  );
}

// \u0434\u043e is Russian "to", for ranges pasted from Russian text.
const RANGE_SEPARATOR = /\s+(?:-|–|—|to|\u0434\u043e|→|->)\s+|\s*\.\.\s*/i;

/** Splits a pasted range like "2026-10-08 10:00 - 2026-10-08 12:00" into both ends, if it is one. */
export function parseRangeInput(input: string, timeZone: TimeZone): { from: number; to: number } | undefined {
  const parts = input.split(RANGE_SEPARATOR);
  if (parts.length !== 2) {
    return undefined;
  }
  const from = parseTimeInput(parts[0], timeZone);
  const to = parseTimeInput(parts[1], timeZone);
  return from !== undefined && to !== undefined ? { from, to } : undefined;
}
