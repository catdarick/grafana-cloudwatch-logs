/** RFC 4180 CSV: every field quoted when it holds a comma, quote or line break. */
export function toCsv(columns: string[], rows: Array<Record<string, string | undefined>>): string {
  const line = (values: Array<string | undefined>) => values.map((v) => escapeField(v ?? '')).join(',');
  return [line(columns), ...rows.map((row) => line(columns.map((c) => row[c])))].join('\r\n');
}

function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Saves text as a file in the browser. The BOM lets Excel read UTF-8 correctly. */
export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
