import { SortKey } from '../language/parse';
import { fieldRef } from '../language/spec';
import { ColumnSettings, LogDetails } from '../types';

export type Row = Record<string, string>;

/** Allowed values per field; a missing key means the column is not filtered. */
export type ValueFilters = Record<string, Set<string>>;

/** Remembered order first, then fields seen for the first time in result order. */
export function orderColumns(fields: string[], settings: ColumnSettings = {}): string[] {
  const known = (settings.order ?? []).filter((f) => fields.includes(f));
  return [...known, ...fields.filter((f) => !known.includes(f))];
}

export function visibleColumns(fields: string[], settings: ColumnSettings = {}): string[] {
  const hidden = new Set(settings.hidden ?? []);
  return orderColumns(fields, settings).filter((f) => !hidden.has(f));
}

export function moveColumn(order: string[], field: string, offset: number): string[] {
  const from = order.indexOf(field);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= order.length) {
    return order;
  }
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, field);
  return next;
}

export function passesFilters(row: Row, filters: ValueFilters, except?: string): boolean {
  return Object.entries(filters).every(([field, allowed]) => field === except || allowed.has(row[field] ?? ''));
}

export interface ValueCount {
  value: string;
  count: number;
}

/**
 * Distinct values of a column, counted over the rows the other columns' filters let through,
 * most frequent first. Values that only occur in filtered-out rows are kept with a zero count
 * so they can still be ticked.
 */
export function valueCounts(rows: Row[], field: string, filters: ValueFilters): ValueCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[field] ?? '';
    const passes = passesFilters(row, filters, field);
    counts.set(value, (counts.get(value) ?? 0) + (passes ? 1 : 0));
  }
  return Array.from(counts, ([value, count]) => ({ value, count })).sort(
    (a, b) => b.count - a.count || a.value.localeCompare(b.value)
  );
}

export function rowMatches(row: Row, columns: string[], needle: string): boolean {
  return columns.some((f) => row[f]?.toLowerCase().includes(needle));
}

export interface TextPart {
  text: string;
  match: boolean;
}

/** Splits text around case-insensitive occurrences of needle (already lower-cased). */
export function splitMatches(text: string, needle: string): TextPart[] {
  if (!needle) {
    return [{ text, match: false }];
  }
  const parts: TextPart[] = [];
  const lower = text.toLowerCase();
  let pos = 0;
  for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, pos)) {
    if (i > pos) {
      parts.push({ text: text.slice(pos, i), match: false });
    }
    parts.push({ text: text.slice(i, i + needle.length), match: true });
    pos = i + needle.length;
  }
  if (pos < text.length) {
    parts.push({ text: text.slice(pos), match: false });
  }
  return parts;
}

/**
 * The whole log event for the expanded row: @message parsed as JSON when it is a JSON object,
 * otherwise the raw message next to the fields the query returned.
 */
export function fullLog(row: Row, details: LogDetails | undefined): unknown {
  const message = details?.message;
  if (message === undefined) {
    return row;
  }
  const trimmed = message.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Not JSON after all: fall through to the raw message.
    }
  }
  return { ...row, '@message': message };
}

/** A Logs Insights `filter` clause for a field and a value taken from a log. */
export function queryFilter(path: string, value: unknown, negate: boolean): string {
  const field = fieldRef(path);
  if (value === null || value === undefined) {
    return negate ? `filter ispresent(${field})` : `filter isempty(${field})`;
  }
  const literal =
    typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(String(value));
  return `filter ${field} ${negate ? '!=' : '='} ${literal}`;
}

const MONO_VALUE = /^(-?\d+(\.\d+)?|[0-9a-f]{8,}|[0-9a-f]{8}-[0-9a-f-]{27,}|\d{4}-\d\d-\d\d[T ][\d:.]+Z?)$/i;

/** Ids, numbers and timestamps read better in a monospace font. */
export function isMonoColumn(values: string[]): boolean {
  const sample = values.filter(Boolean).slice(0, 100);
  return sample.length > 0 && sample.every((v) => MONO_VALUE.test(v));
}

/** Starting width from the header and the 90th percentile of value lengths. */
export function estimateWidth(field: string, values: string[]): number {
  const lengths = values
    .slice(0, 300)
    .map((v) => v.length)
    .sort((a, b) => a - b);
  const typical = lengths.length ? lengths[Math.floor((lengths.length - 1) * 0.9)] : 0;
  const chars = Math.max(field.length + 3, typical);
  return Math.round(Math.min(420, Math.max(72, chars * 7.5 + 24)));
}

export interface Bin {
  start: number;
  end: number;
  counts: Record<string, number>;
  total: number;
}

/** Splits [from, to) into equal bins and counts points per bin, split by a category. */
export function histogram(points: Array<{ time: number; group: string }>, from: number, to: number, bins = 60): Bin[] {
  const size = Math.max(1, (to - from) / bins);
  const result: Bin[] = Array.from({ length: bins }, (_, i) => ({
    start: from + i * size,
    end: from + (i + 1) * size,
    counts: {},
    total: 0,
  }));
  for (const { time, group } of points) {
    if (time < from || time > to) {
      continue;
    }
    const bin = result[Math.min(bins - 1, Math.floor((time - from) / size))];
    bin.counts[group] = (bin.counts[group] ?? 0) + 1;
    bin.total++;
  }
  return result;
}

/**
 * Order of row indexes following the sort keys. Values that are both numbers compare as numbers;
 * missing values go last. getValue lets @timestamp come from row details when it is not a column.
 */
export function sortOrder(
  count: number,
  keys: SortKey[],
  getValue: (index: number, field: string) => unknown
): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  if (keys.length === 0) {
    return order;
  }
  return order.sort((a, b) => {
    for (const { field, desc } of keys) {
      const va = getValue(a, field);
      const vb = getValue(b, field);
      // Missing values go last in either direction.
      const missing = Number(isMissing(va)) - Number(isMissing(vb));
      if (missing !== 0) {
        return missing;
      }
      const cmp = isMissing(va) ? 0 : compareValues(va, vb);
      if (cmp !== 0) {
        return desc ? -cmp : cmp;
      }
    }
    return a - b;
  });
}

const isMissing = (v: unknown) => v === undefined || v === null || v === '';

function compareValues(a: unknown, b: unknown): number {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) {
    return na - nb;
  }
  return String(a).localeCompare(String(b));
}

export interface Unloaded {
  from: number;
  to: number;
  /** Matched logs that did not fit the limit; all of them lie in this range. */
  count: number;
}

/**
 * The part of the time range whose logs were cut off by the query's limit. Only known when rows are
 * sorted by @timestamp: newest-first leaves the start of the range unloaded, oldest-first the end.
 */
export function unloadedRange(
  times: number[],
  from: number,
  to: number,
  sort: SortKey[],
  matched: number | undefined
): Unloaded | undefined {
  const missing = (matched ?? 0) - times.length;
  if (missing <= 0 || times.length === 0 || sort[0]?.field !== '@timestamp') {
    return undefined;
  }
  if (sort[0].desc) {
    const oldest = Math.min(...times);
    return oldest > from ? { from, to: oldest, count: missing } : undefined;
  }
  const newest = Math.max(...times);
  return newest < to ? { from: newest, to, count: missing } : undefined;
}

/**
 * Leaf values of a JSON log event by dotted path, the way Logs Insights names discovered fields
 * (kubernetes.pod_name, items.0.id). Values are strings as they would show in a table cell.
 */
export function flattenJson(value: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
    for (const [key, child] of entries) {
      flattenJson(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  if (prefix && value !== null && value !== undefined && value !== '') {
    out[prefix] = String(value);
  }
  return out;
}

/** flattenJson of a raw @message when it is a JSON object, else nothing. */
export function flattenMessage(message: string | undefined): Record<string, string> {
  const trimmed = message?.trim();
  if (!trimmed?.startsWith('{')) {
    return {};
  }
  try {
    return flattenJson(JSON.parse(trimmed));
  } catch {
    return {};
  }
}

const NUMBER = /^-?\d+(\.\d+)?$/;

function literal(value: string, numeric: boolean): string {
  return numeric && NUMBER.test(value) ? value : JSON.stringify(value);
}

/**
 * One Logs Insights `filter` clause per table filter: the allowed values as `=` or `in`, or the
 * excluded ones as `!=` / `not in` when that list is shorter. Empty values map to isempty().
 */
export function valueFilterClause(field: string, allowed: Set<string>, allValues: string[], numeric: boolean): string {
  const ref = fieldRef(field);
  const distinct = Array.from(new Set(allValues));
  const excluded = distinct.filter((v) => !allowed.has(v));
  const exclude = excluded.length < allowed.size;
  const values = exclude ? excluded : Array.from(allowed);
  const empty = values.includes('');
  const rest = values.filter((v) => v !== '').map((v) => literal(v, numeric));
  const parts: string[] = [];
  if (rest.length === 1) {
    parts.push(`${ref} ${exclude ? '!=' : '='} ${rest[0]}`);
  } else if (rest.length > 1) {
    parts.push(`${ref} ${exclude ? 'not in' : 'in'} [${rest.join(', ')}]`);
  }
  if (empty) {
    parts.push(exclude ? `ispresent(${ref})` : `isempty(${ref})`);
  }
  if (parts.length === 0) {
    // Nothing allowed at all.
    return `filter ${exclude ? `ispresent(${ref}) or isempty(${ref})` : `isempty(${ref}) and ispresent(${ref})`}`;
  }
  const condition = parts.join(exclude ? ' and ' : ' or ');
  // A comparison is false for logs without the field, so keep them explicitly when they are allowed.
  if (exclude && !empty && distinct.includes('')) {
    return `filter ${parts.length > 1 ? `(${condition})` : condition} or isempty(${ref})`;
  }
  return `filter ${condition}`;
}

/** Search text as a case-insensitive regex filter over the searched columns. */
export function searchClause(text: string, fields: string[]): string {
  const pattern = `/(?i)${text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/`;
  return `filter ${fields.map((f) => `${fieldRef(f)} like ${pattern}`).join(' or ')}`;
}
