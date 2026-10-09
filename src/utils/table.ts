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
