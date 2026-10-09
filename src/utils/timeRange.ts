import { dateTimeFormat } from '@grafana/data';
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

export function describeTimeRange(range: TimeRangeValue): string {
  if (range.mode === 'relative') {
    const unit = range.amount === 1 ? range.unit.slice(0, -1) : range.unit;
    return `Last ${range.amount} ${unit}`;
  }
  return `${formatTime(range.from)} → ${formatTime(range.to)}`;
}

export function formatTime(ms: number): string {
  return dateTimeFormat(ms, { format: 'YYYY-MM-DD HH:mm:ss' });
}

export function isValidRange(range: TimeRangeValue): boolean {
  if (range.mode === 'relative') {
    return Number.isFinite(range.amount) && range.amount > 0;
  }
  return Number.isFinite(range.from) && Number.isFinite(range.to) && range.from < range.to;
}
