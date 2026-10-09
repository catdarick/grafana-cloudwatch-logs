import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import type { TimeZone } from '@grafana/schema';
import { Button, Checkbox, ClipboardButton, Icon, IconButton, Input, useStyles2 } from '@grafana/ui';
import { ColumnSettings, QueryResult } from '../../types';
import { formatTime } from '../../utils/timeRange';
import {
  ValueFilters,
  fullLog,
  moveColumn,
  orderColumns,
  passesFilters,
  rowMatches,
  splitMatches,
  valueCounts,
  visibleColumns,
} from '../../utils/table';
import { ColumnMenu } from './ColumnMenu';
import { ColumnsPicker } from './ColumnsPicker';

interface Props {
  result: QueryResult;
  timeZone: TimeZone;
  columns: ColumnSettings;
  onColumnsChange: (columns: ColumnSettings) => void;
}

const PAGE = 500;
const EXPAND_WIDTH = 32;
const DEFAULT_WIDTH = 200;
const MIN_WIDTH = 48;
const LEVEL_FIELDS = ['severity', 'level', 'loglevel', 'log_level', 'lvl'];

type Level = 'error' | 'warning' | 'debug' | undefined;

function rowLevel(row: Record<string, string>, levelField?: string): Level {
  const value = levelField ? row[levelField]?.toLowerCase() : undefined;
  if (!value) {
    return undefined;
  }
  if (/err|fatal|crit|panic|emerg|alert/.test(value)) {
    return 'error';
  }
  if (/warn/.test(value)) {
    return 'warning';
  }
  if (/debug|trace/.test(value)) {
    return 'debug';
  }
  return undefined;
}

export function ResultsTable({ result, timeZone, columns, onColumnsChange }: Props) {
  const s = useStyles2(getStyles);
  const [filters, setFilters] = useState<ValueFilters>({});
  const [search, setSearch] = useState('');
  const [hideNonMatching, setHideNonMatching] = useState(false);
  const [current, setCurrent] = useState(0);
  const [scrollRequest, setScrollRequest] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [draftWidths, setDraftWidths] = useState<Record<string, number>>();
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());
  const headerRefs = useRef(new Map<string, HTMLTableCellElement>());

  // Time fields arrive as epoch millis; show them in the selected zone.
  const displayRows = useMemo(
    () =>
      result.rows.map((row) => {
        const out = { ...row };
        for (const f of result.timeFields) {
          if (out[f] !== undefined) {
            out[f] = formatTime(Number(out[f]), timeZone, 'YYYY-MM-DD HH:mm:ss.SSS');
          }
        }
        return out;
      }),
    [result, timeZone]
  );

  const cols = useMemo(() => visibleColumns(result.fields, columns), [result.fields, columns]);
  const needle = search.trim().toLowerCase();

  const filtered = useMemo(
    () => displayRows.flatMap((row, index) => (passesFilters(row, filters) ? [index] : [])),
    [displayRows, filters]
  );

  // Search covers the visible columns, so every match has something to highlight.
  const matches = useMemo(
    () => (needle ? filtered.filter((i) => rowMatches(displayRows[i], cols, needle)) : []),
    [displayRows, filtered, cols, needle]
  );
  const matchSet = useMemo(() => new Set(matches), [matches]);

  const rows = needle && hideNonMatching ? matches : filtered;
  const currentRow = matches.length > 0 ? matches[Math.min(current, matches.length - 1)] : undefined;

  useEffect(() => {
    if (currentRow !== undefined) {
      rowRefs.current.get(currentRow)?.scrollIntoView({ block: 'nearest' });
    }
    // Scroll only when asked (typing or prev/next), not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest]);

  const goTo = (index: number) => {
    if (matches.length === 0) {
      return;
    }
    const next = (index + matches.length) % matches.length;
    const position = rows.indexOf(matches[next]);
    if (position >= shown) {
      setShown(Math.ceil((position + 1) / PAGE) * PAGE);
    }
    setCurrent(next);
    setScrollRequest((n) => n + 1);
  };

  const onSearch = (value: string) => {
    setSearch(value);
    setCurrent(0);
    setScrollRequest((n) => n + 1);
  };

  const setFilter = (field: string, allowed: Set<string> | undefined) => {
    setFilters((f) => {
      const next = { ...f };
      allowed ? (next[field] = allowed) : delete next[field];
      return next;
    });
    setShown(PAGE);
  };

  const levelField = result.fields.find((f) => LEVEL_FIELDS.includes(f.toLowerCase()));

  const toggle = (index: number) => {
    const next = new Set(expanded);
    next.has(index) ? next.delete(index) : next.add(index);
    setExpanded(next);
  };

  // Columns size to content until the first resize; then every visible column gets a fixed width.
  const widths = draftWidths ?? columns.widths ?? {};
  const fixed = cols.some((f) => widths[f] !== undefined);
  const widthOf = (f: string) => widths[f] ?? DEFAULT_WIDTH;

  const startResize = (event: React.MouseEvent, field: string) => {
    event.preventDefault();
    event.stopPropagation();
    const base: Record<string, number> = { ...(columns.widths ?? {}) };
    if (!fixed) {
      cols.forEach((f) => (base[f] = Math.round(headerRefs.current.get(f)?.getBoundingClientRect().width ?? 0)));
    }
    const startX = event.clientX;
    const startWidth = base[field] ?? DEFAULT_WIDTH;
    let latest = base;
    const move = (e: MouseEvent) => {
      latest = { ...base, [field]: Math.max(MIN_WIDTH, Math.round(startWidth + e.clientX - startX)) };
      setDraftWidths(latest);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      setDragCursor(false);
      setDraftWidths(undefined);
      onColumnsChange({ ...columns, widths: latest });
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    setDragCursor(true);
  };

  const hideColumn = (field: string) => onColumnsChange({ ...columns, hidden: [...(columns.hidden ?? []), field] });
  const moveVisible = (field: string, offset: number) => {
    // Move past hidden neighbours too, so one click always changes what is on screen.
    const order = orderColumns(result.fields, columns);
    const target = cols[cols.indexOf(field) + offset];
    if (target) {
      onColumnsChange({ ...columns, order: moveColumn(order, field, order.indexOf(target) - order.indexOf(field)) });
    }
  };

  const highlight = (text: string, index: number) =>
    needle && matchSet.has(index)
      ? splitMatches(text, needle).map((part, i) =>
          part.match ? (
            <mark key={i} className={s.mark}>
              {part.text}
            </mark>
          ) : (
            part.text
          )
        )
      : text;

  const filterCount = Object.keys(filters).length;
  const total = result.rows.length;

  return (
    <div className={s.wrapper}>
      <div className={s.toolbar}>
        <div className={s.search}>
          <Input
            prefix={<Icon name="search" />}
            placeholder="Search loaded logs"
            value={search}
            width={40}
            onChange={(e) => onSearch(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                goTo(current + (e.shiftKey ? -1 : 1));
              } else if (e.key === 'Escape') {
                onSearch('');
              }
            }}
            suffix={
              search ? (
                <IconButton name="times" size="sm" aria-label="Clear search" onClick={() => onSearch('')} />
              ) : null
            }
          />
          {needle && (
            <>
              <span className={s.count}>
                {matches.length > 0
                  ? `${Math.min(current, matches.length - 1) + 1} of ${matches.length}`
                  : 'No matches'}
              </span>
              <IconButton
                name="angle-up"
                aria-label="Previous match"
                tooltip="Previous (Shift+Enter)"
                disabled={matches.length === 0}
                onClick={() => goTo(current - 1)}
              />
              <IconButton
                name="angle-down"
                aria-label="Next match"
                tooltip="Next (Enter)"
                disabled={matches.length === 0}
                onClick={() => goTo(current + 1)}
              />
            </>
          )}
          <Checkbox
            label="Hide non-matching"
            value={hideNonMatching}
            onChange={(e) => {
              setHideNonMatching(e.currentTarget.checked);
              setScrollRequest((n) => n + 1);
            }}
          />
        </div>
        <span className={s.count}>{rows.length === total ? total : `${rows.length} of ${total}`} rows</span>
        {filterCount > 0 && (
          <Button size="sm" variant="secondary" icon="times" onClick={() => setFilters({})}>
            Clear {filterCount === 1 ? 'filter' : `${filterCount} filters`}
          </Button>
        )}
        <ColumnsPicker fields={result.fields} settings={columns} onChange={onColumnsChange} />
      </div>
      <div className={s.scroll}>
        <table
          className={cx(s.table, fixed && s.fixed)}
          style={fixed ? { width: EXPAND_WIDTH + cols.reduce((sum, f) => sum + widthOf(f), 0) } : undefined}
        >
          {fixed && (
            <colgroup>
              <col style={{ width: EXPAND_WIDTH }} />
              {cols.map((f) => (
                <col key={f} style={{ width: widthOf(f) }} />
              ))}
            </colgroup>
          )}
          <thead>
            <tr>
              <th className={s.expandCol} />
              {cols.map((f) => (
                <th key={f} ref={(el) => (el ? headerRefs.current.set(f, el) : headerRefs.current.delete(f))}>
                  <div className={s.header}>
                    <span className={s.headerName} title={f}>
                      {f}
                    </span>
                    <ColumnMenu
                      field={f}
                      allowed={filters[f]}
                      getValues={() => valueCounts(displayRows, f, filters)}
                      onChange={(allowed) => setFilter(f, allowed)}
                      onHide={() => hideColumn(f)}
                      onMove={(offset) => moveVisible(f, offset)}
                    />
                  </div>
                  <div
                    className={s.resizer}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${f}`}
                    onMouseDown={(e) => startResize(e, f)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((index) => {
              const row = displayRows[index];
              const details = result.details?.[index];
              return (
                <React.Fragment key={index}>
                  <tr
                    ref={(el) => (el ? rowRefs.current.set(index, el) : rowRefs.current.delete(index))}
                    className={cx(
                      s.level[rowLevel(row, levelField) ?? 'none'],
                      matchSet.has(index) && s.match,
                      index === currentRow && s.current
                    )}
                  >
                    <td className={s.expandCol}>
                      <IconButton
                        size="sm"
                        name={expanded.has(index) ? 'angle-down' : 'angle-right'}
                        aria-label="Toggle row details"
                        onClick={() => toggle(index)}
                      />
                    </td>
                    {cols.map((f) => (
                      <td key={f}>{highlight(row[f] ?? '', index)}</td>
                    ))}
                  </tr>
                  {expanded.has(index) && (
                    <tr className={s.detailsRow}>
                      <td />
                      <td colSpan={cols.length}>
                        <LogDetailsView
                          json={JSON.stringify(fullLog(row, details), null, 2)}
                          logGroup={details?.logGroup}
                          logStream={details?.logStream}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols.length + 1} className={s.empty} style={{ textAlign: 'center' }}>
                  {total === 0 ? 'No rows' : 'No rows match the current filters'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > shown && (
        <button type="button" className={s.more} onClick={() => setShown(shown + PAGE)}>
          Show {Math.min(PAGE, rows.length - shown)} more
        </button>
      )}
    </div>
  );
}

/** Keeps the resize cursor and blocks text selection while the mouse is anywhere on the page. */
function setDragCursor(dragging: boolean) {
  document.body.style.cursor = dragging ? 'col-resize' : '';
  document.body.style.userSelect = dragging ? 'none' : '';
}

function LogDetailsView({ json, logGroup, logStream }: { json: string; logGroup?: string; logStream?: string }) {
  const s = useStyles2(getStyles);
  return (
    <div className={s.details}>
      <div className={s.detailsBar}>
        <span className={s.source}>{[logGroup, logStream].filter(Boolean).join(' · ')}</span>
        <ClipboardButton size="sm" variant="secondary" fill="text" icon="copy" getText={() => json}>
          Copy JSON
        </ClipboardButton>
      </div>
      <pre className={s.json}>{json}</pre>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(1), minHeight: 0 }),
  toolbar: css({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: theme.spacing(2) }),
  search: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1), marginRight: 'auto' }),
  count: css({ color: theme.colors.text.secondary, whiteSpace: 'nowrap' }),
  scroll: css({
    overflow: 'auto',
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
  }),
  table: css({
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: theme.typography.bodySmall.fontSize,
    'th, td': {
      padding: theme.spacing(0.75, 1),
      textAlign: 'left',
      verticalAlign: 'top',
      borderBottom: `1px solid ${theme.colors.border.weak}`,
      wordBreak: 'break-word',
    },
    th: {
      position: 'sticky',
      top: 0,
      zIndex: 1,
      background: theme.colors.background.secondary,
      fontWeight: theme.typography.fontWeightMedium,
      whiteSpace: 'nowrap',
      paddingRight: theme.spacing(1.5),
    },
    'tbody tr:hover': { background: theme.colors.action.hover },
  }),
  fixed: css({ tableLayout: 'fixed' }),
  header: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(0.5) }),
  headerName: css({ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }),
  resizer: css({
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 6,
    cursor: 'col-resize',
    borderRight: `1px solid ${theme.colors.border.weak}`,
    '&:hover': { borderRight: `2px solid ${theme.colors.primary.main}` },
  }),
  expandCol: css({ width: EXPAND_WIDTH }),
  level: {
    none: css({}),
    error: css({ 'td:first-child': { boxShadow: `inset 3px 0 ${theme.colors.error.main}` } }),
    warning: css({ 'td:first-child': { boxShadow: `inset 3px 0 ${theme.colors.warning.main}` } }),
    debug: css({ color: theme.colors.text.secondary }),
  },
  match: css({ background: theme.colors.action.selected }),
  current: css({ outline: `2px solid ${theme.colors.primary.border}`, outlineOffset: -2 }),
  mark: css({
    background: theme.colors.warning.transparent,
    color: 'inherit',
    padding: 0,
    borderRadius: 2,
  }),
  empty: css({ color: theme.colors.text.secondary }),
  detailsRow: css({ '&:hover': { background: 'none !important' } }),
  details: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(0.5) }),
  detailsBar: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1) }),
  source: css({ flex: 1, color: theme.colors.text.secondary, wordBreak: 'break-all' }),
  json: css({
    margin: 0,
    maxHeight: 600,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  more: css({
    alignSelf: 'center',
    background: 'none',
    border: 'none',
    color: theme.colors.text.link,
    cursor: 'pointer',
  }),
});
