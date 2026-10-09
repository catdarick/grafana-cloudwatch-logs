import { dateTimeFormat, timeZoneAbbrevation } from '@grafana/data';
import type { TimeZone } from '@grafana/schema';
import { TimeRangeValue, TimeUnit } from '../types';

export const AMOUNTS = [1, 2, 3, 5, 7, 10, 15, 30, 60, 90];
export const UNITS: TimeUnit[] = ['minutes', 'hours', 'days'];

const UNIT_MS: Record<TimeUnit, number> = {
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
};

export const DEFAULT_TIME_RANGE: TimeRangeValue = { mode: 'relative', amount: 30, unit: 'minutes' };

export function toEpochRange(range: TimeRangeValue, now: number = Date.now()): { from: number; to: number } {
  if (range.mode === 'absolute') {
    return { from: range.from, to: range.to };
  }
  return { from: now - range.amount * UNIT_MS[range.unit], to: now };
}

export function describeTimeRange(range: TimeRangeValue, timeZone: TimeZone): string {
  if (range.mode === 'relative') {
    const unit = range.amount === 1 ? range.unit.slice(0, -1) : range.unit;
    return `Last ${range.amount} ${unit}`;
  }
  return `${formatTime(range.from, timeZone)} → ${formatTime(range.to, timeZone)} ${zoneLabel(range.from, timeZone)}`;
}

export function formatTime(ms: number, timeZone: TimeZone, format = 'YYYY-MM-DD HH:mm:ss'): string {
  return dateTimeFormat(ms, { format, timeZone });
}

/** Short zone label for display, e.g. "UTC" or "MSK". */
export function zoneLabel(ms: number, timeZone: TimeZone): string {
  return timeZone === 'utc' ? 'UTC' : timeZoneAbbrevation(ms, { timeZone }) || timeZone;
}

export function isValidRange(range: TimeRangeValue): boolean {
  if (range.mode === 'relative') {
    return Number.isFinite(range.amount) && range.amount > 0;
  }
  return Number.isFinite(range.from) && Number.isFinite(range.to) && range.from < range.to;
}
