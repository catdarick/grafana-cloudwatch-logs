import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { useVirtualizer } from '@tanstack/react-virtual';
import { GrafanaTheme2 } from '@grafana/data';
import type { TimeZone } from '@grafana/schema';
import { Button, Checkbox, ClipboardButton, Icon, IconButton, Input, useStyles2 } from '@grafana/ui';
import { ColumnSettings, QueryResult } from '../../types';
import { copyWithToast } from '../../utils/clipboard';
import { formatTime } from '../../utils/timeRange';
import {
  ValueFilters,
  estimateWidth,
  fullLog,
  histogram,
  isMonoColumn,
  moveColumn,
  orderColumns,
  parseSort,
  passesFilters,
  queryFilter,
  rowMatches,
  splitMatches,
  unloadedRange,
  valueCounts,
  visibleColumns,
} from '../../utils/table';
import { ColumnMenu } from './ColumnMenu';
import { ColumnsPicker } from './ColumnsPicker';
import { Histogram } from './Histogram';
import { JsonTree } from './JsonTree';

interface Props {
  result: QueryResult;
  timeZone: TimeZone;
  columns: ColumnSettings;
  onColumnsChange: (columns: ColumnSettings) => void;
  /** Sets the tab's time range to the zoomed window and re-runs, for more than the loaded rows. */
  onRunRange: (from: number, to: number) => void;
  /** Adds a Logs Insights clause to the tab's query and re-runs. */
  onAddQueryFilter: (clause: string) => void;
}

const EXPAND_WIDTH = 32;
const MIN_WIDTH = 48;
/** Room left for the column that takes up the remaining width. */
const FLEX_MIN_WIDTH = 240;
const LEVEL_FIELDS = ['severity', 'level', 'loglevel', 'log_level', 'lvl'];

type Level = 'error' | 'warning' | 'info' | 'debug' | undefined;

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
  if (/info|notice/.test(value)) {
    return 'info';
  }
  return undefined;
}

export function ResultsTable({ result, timeZone, columns, onColumnsChange, onRunRange, onAddQueryFilter }: Props) {
  const s = useStyles2(getStyles);
  const [filters, setFilters] = useState<ValueFilters>({});
  // Time window picked on the histogram; narrows the loaded rows without a new query.
  const [zoom, setZoom] = useState<{ from: number; to: number }>();
  const [search, setSearch] = useState('');
  const [hideNonMatching, setHideNonMatching] = useState(false);
  const [current, setCurrent] = useState(0);
  const [scrollRequest, setScrollRequest] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // Rows whose long cells are shown in full instead of clamped to two lines.
  const [unclamped, setUnclamped] = useState<Set<number>>(new Set());
  const [draftWidths, setDraftWidths] = useState<Record<string, number>>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(0);

  // Expanded details are pinned to the visible part of a wide table, so they need its width.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(() => setViewWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
  const levelField = result.fields.find((f) => LEVEL_FIELDS.includes(f.toLowerCase()));

  // Per column: starting width from content, and whether it holds ids/numbers/times.
  const columnInfo = useMemo(() => {
    const info: Record<string, { width: number; mono: boolean }> = {};
    for (const f of result.fields) {
      const values = displayRows.map((r) => r[f] ?? '');
      info[f] = { width: estimateWidth(f, values), mono: result.timeFields.includes(f) || isMonoColumn(values) };
    }
    return info;
  }, [displayRows, result.fields, result.timeFields]);

  const inZoom = useMemo(
    () =>
      displayRows.map((_, i) => {
        const time = result.details[i]?.timestamp;
        return !zoom || (time !== undefined && time >= zoom.from && time <= zoom.to);
      }),
    [displayRows, result.details, zoom]
  );

  const filtered = useMemo(
    () => displayRows.flatMap((row, index) => (inZoom[index] && passesFilters(row, filters) ? [index] : [])),
    [displayRows, filters, inZoom]
  );

  // Search covers the visible columns, so every match has something to highlight.
  const matches = useMemo(
    () => (needle ? filtered.filter((i) => rowMatches(displayRows[i], cols, needle)) : []),
    [displayRows, filtered, cols, needle]
  );
  const matchSet = useMemo(() => new Set(matches), [matches]);

  const rows = needle && hideNonMatching ? matches : filtered;
  const currentRow = matches.length > 0 ? matches[Math.min(current, matches.length - 1)] : undefined;

  // Rows cut off by the limit: where they are on the time axis (when we can tell) and how many.
  const unloaded = useMemo(() => {
    const times = result.details.flatMap((d) => (d.timestamp === undefined ? [] : [d.timestamp]));
    return unloadedRange(times, result.from, result.to, parseSort(result.query ?? ''), result.stats?.recordsMatched);
  }, [result]);

  // The axis (query range or zoom), the hatched part of it, and bins over the rest, so the last bar
  // ends exactly where the hatching starts.
  const histo = useMemo(() => {
    const view = zoom ?? { from: result.from, to: result.to };
    const from = unloaded ? Math.max(unloaded.from, view.from) : 0;
    const to = unloaded ? Math.min(unloaded.to, view.to) : 0;
    const gap =
      unloaded && to > from
        ? { from, to, count: unloaded.count, whole: unloaded.from >= view.from && unloaded.to <= view.to }
        : undefined;
    const loaded = !gap
      ? view
      : gap.from <= view.from
        ? { from: gap.to, to: view.to }
        : { from: view.from, to: gap.from };
    const points = rows.flatMap((i) => {
      const time = result.details[i]?.timestamp;
      const level = rowLevel(displayRows[i], levelField);
      return time === undefined ? [] : [{ time, group: level === 'info' || !level ? 'other' : level }];
    });
    if (points.length === 0 && !zoom) {
      return undefined;
    }
    // Keep bars about as wide as on a full axis when they only cover part of it.
    const share = (loaded.to - loaded.from) / Math.max(1, view.to - view.from);
    const count = Math.max(1, Math.min(60, Math.round(60 * share)));
    return { view, gap, bins: loaded.to > loaded.from ? histogram(points, loaded.from, loaded.to, count) : [] };
  }, [rows, result, displayRows, levelField, zoom, unloaded]);

  // What the bars stand for. Without zoom: loaded vs matched for the whole query. With zoom we only
  // know the loaded count in the window, and whether the window reaches into the cut-off part.
  const caption = useMemo(() => {
    const matched = result.stats?.recordsMatched;
    const truncated = matched !== undefined && matched > result.rows.length;
    if (!zoom) {
      return truncated
        ? `${result.rows.length.toLocaleString('en-US')} of ${Math.round(matched).toLocaleString('en-US')} matched logs`
        : undefined;
    }
    if (!truncated) {
      return undefined;
    }
    const loaded = inZoom.filter(Boolean).length.toLocaleString('en-US');
    if (histo?.gap) {
      return `${loaded} loaded logs here, more in the hatched part`;
    }
    // Sorted by time, so everything matched in a window outside the cut-off part is loaded.
    return unloaded ? undefined : `${loaded} loaded logs here, the range may have more`;
  }, [result, zoom, inZoom, histo, unloaded]);

  // No React Compiler here anyway; the virtualizer is re-read on every render by design.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 34,
    overscan: 12,
    getItemKey: (i) => rows[i],
  });

  useEffect(() => {
    if (currentRow !== undefined) {
      const position = rows.indexOf(currentRow);
      if (position >= 0) {
        virtualizer.scrollToIndex(position, { align: 'center' });
      }
    }
    // Scroll only when asked (typing or prev/next), not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest]);

  const goTo = (index: number) => {
    if (matches.length === 0) {
      return;
    }
    setCurrent((index + matches.length) % matches.length);
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
  };

  const filterValue = (field: string, value: string, exclude: boolean) => {
    if (!exclude) {
      setFilter(field, new Set([value]));
      return;
    }
    const allowed = new Set(filters[field] ?? displayRows.map((r) => r[field] ?? ''));
    allowed.delete(value);
    setFilter(field, allowed);
  };

  const toggleIn = (set: Set<number>, update: (s: Set<number>) => void, index: number) => {
    const next = new Set(set);
    next.has(index) ? next.delete(index) : next.add(index);
    update(next);
  };

  // Widths: what the user dragged, else an estimate from content. The widest unsized column
  // takes the remaining space so the table always fills the panel.
  const userWidths = draftWidths ?? columns.widths ?? {};
  const flexCol = cols
    .filter((f) => userWidths[f] === undefined)
    .reduce<string | undefined>(
      (best, f) => (!best || columnInfo[f].width > columnInfo[best].width ? f : best),
      undefined
    );
  const widthOf = (f: string) => userWidths[f] ?? columnInfo[f]?.width ?? 120;
  const fixedSum = EXPAND_WIDTH + cols.filter((f) => f !== flexCol).reduce((sum, f) => sum + widthOf(f), 0);

  const startResize = (event: React.MouseEvent, field: string) => {
    event.preventDefault();
    event.stopPropagation();
    const base: Record<string, number> = { ...(columns.widths ?? {}) };
    const th = (event.currentTarget as HTMLElement).parentElement;
    const startX = event.clientX;
    const startWidth = Math.round(th?.getBoundingClientRect().width ?? widthOf(field));
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

  const renderCell = (field: string, value: string, index: number) => {
    if (field === levelField && value) {
      const level = rowLevel(displayRows[index], levelField) ?? 'none';
      return <span className={cx(s.badge, s.badgeLevel[level])}>{highlight(value, index)}</span>;
    }
    return highlight(value, index);
  };

  const filterCount = Object.keys(filters).length;
  const total = result.rows.length;
  const items = virtualizer.getVirtualItems();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;

  return (
    <div className={s.wrapper}>
      {zoom && (
        <div className={s.zoomBar}>
          <Icon name="search-plus" />
          <span>
            Showing loaded logs from {formatTime(zoom.from, timeZone, 'YYYY-MM-DD HH:mm:ss')} to{' '}
            {formatTime(zoom.to, timeZone, 'HH:mm:ss')}
          </span>
          <Button size="sm" variant="secondary" fill="text" icon="times" onClick={() => setZoom(undefined)}>
            Reset zoom
          </Button>
          <Button
            size="sm"
            variant="secondary"
            fill="text"
            icon="sync"
            tooltip="Only loaded rows are shown. Run the query for this range to get everything in it."
            onClick={() => onRunRange(zoom.from, zoom.to)}
          >
            Run for this range
          </Button>
        </div>
      )}
      {histo && (
        <Histogram
          view={histo.view}
          bins={histo.bins}
          gap={histo.gap}
          timeZone={timeZone}
          onZoom={(from, to) => setZoom({ from, to })}
          caption={caption}
          onRunRange={onRunRange}
        />
      )}

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

      <div className={s.scroll} ref={scrollRef}>
        <table
          className={s.table}
          style={{ width: flexCol ? '100%' : fixedSum, minWidth: fixedSum + (flexCol ? FLEX_MIN_WIDTH : 0) }}
        >
          <colgroup>
            <col style={{ width: EXPAND_WIDTH }} />
            {cols.map((f) => (
              <col key={f} style={f === flexCol ? undefined : { width: widthOf(f) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th />
              {cols.map((f) => (
                <th key={f}>
                  <div className={s.header}>
                    <span className={s.headerName} title={f}>
                      {f}
                    </span>
                    <ColumnMenu
                      field={f}
                      allowed={filters[f]}
                      getValues={() =>
                        valueCounts(
                          displayRows.filter((_, i) => inZoom[i]),
                          f,
                          filters
                        )
                      }
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
          {padTop > 0 && (
            <tbody>
              <tr style={{ height: padTop }} />
            </tbody>
          )}
          {items.map((item) => {
            const index = rows[item.index];
            const row = displayRows[index];
            const details = result.details[index];
            const isOpen = expanded.has(index);
            return (
              <tbody key={item.key} data-index={item.index} ref={virtualizer.measureElement}>
                <tr
                  className={cx(
                    s.row,
                    item.index % 2 === 1 && s.odd,
                    s.level[rowLevel(row, levelField) ?? 'none'],
                    matchSet.has(index) && s.match,
                    index === currentRow && s.current
                  )}
                >
                  <td className={s.expandCell}>
                    <IconButton
                      size="sm"
                      name={isOpen ? 'angle-down' : 'angle-right'}
                      aria-label="Toggle row details"
                      onClick={() => toggleIn(expanded, setExpanded, index)}
                    />
                  </td>
                  {cols.map((f) => {
                    const value = row[f] ?? '';
                    return (
                      <td key={f} className={cx(columnInfo[f]?.mono && s.mono)}>
                        <div
                          className={cx(s.cellText, !unclamped.has(index) && s.clamp)}
                          onClick={() => {
                            // Clicking expands long text; selecting text to copy should not.
                            if (!window.getSelection()?.toString()) {
                              toggleIn(unclamped, setUnclamped, index);
                            }
                          }}
                        >
                          {renderCell(f, value, index)}
                        </div>
                        {value && (
                          <div className={s.cellActions}>
                            <IconButton
                              name="search-plus"
                              size="sm"
                              tooltip="Show only this value"
                              onClick={() => filterValue(f, value, false)}
                            />
                            <IconButton
                              name="search-minus"
                              size="sm"
                              tooltip="Hide this value"
                              onClick={() => filterValue(f, value, true)}
                            />
                            <IconButton
                              name="copy"
                              size="sm"
                              tooltip="Copy value"
                              onClick={() => copyWithToast(result.rows[index][f] ?? value)}
                            />
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
                {isOpen && (
                  <tr className={s.detailsRow}>
                    <td />
                    <td colSpan={cols.length}>
                      <LogDetailsView
                        width={viewWidth - EXPAND_WIDTH - 24}
                        log={fullLog(row, details)}
                        logGroup={details?.logGroup}
                        logStream={details?.logStream}
                        onFilter={(path, value, negate) => onAddQueryFilter(queryFilter(path, value, negate))}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
          {padBottom > 0 && (
            <tbody>
              <tr style={{ height: padBottom }} />
            </tbody>
          )}
          {rows.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={cols.length + 1} className={s.empty} style={{ textAlign: 'center' }}>
                  {total === 0 ? 'No rows' : 'No rows match the current filters'}
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
    </div>
  );
}

/** Keeps the resize cursor and blocks text selection while the mouse is anywhere on the page. */
function setDragCursor(dragging: boolean) {
  document.body.style.cursor = dragging ? 'col-resize' : '';
  document.body.style.userSelect = dragging ? 'none' : '';
}

interface LogDetailsProps {
  width: number;
  log: unknown;
  logGroup?: string;
  logStream?: string;
  onFilter: (path: string, value: unknown, negate: boolean) => void;
}

function LogDetailsView({ width, log, logGroup, logStream, onFilter }: LogDetailsProps) {
  const s = useStyles2(getStyles);
  const json = useMemo(() => JSON.stringify(log, null, 2), [log]);
  return (
    <div className={s.details} style={width > 0 ? { width } : undefined}>
      <div className={s.detailsBar}>
        <span className={s.source}>{[logGroup, logStream].filter(Boolean).join(' · ')}</span>
        <ClipboardButton size="sm" variant="secondary" fill="text" icon="copy" getText={() => json}>
          Copy JSON
        </ClipboardButton>
      </div>
      <JsonTree value={log} onFilter={onFilter} />
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(1), minHeight: 0 }),
  // Sticks to the top of the page while scrolling, so search stays reachable.
  toolbar: css({
    position: 'sticky',
    top: 0,
    zIndex: 3,
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing(2),
    padding: theme.spacing(1, 0),
    background: theme.colors.background.canvas,
  }),
  search: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1), marginRight: 'auto' }),
  zoomBar: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5, 1),
    borderRadius: theme.shape.radius.default,
    background: theme.colors.primary.transparent,
    color: theme.colors.text.primary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  count: css({ color: theme.colors.text.secondary, whiteSpace: 'nowrap' }),
  // Own scroll area: keeps the header visible and lets only the rows on screen render.
  scroll: css({
    overflow: 'auto',
    maxHeight: 'max(360px, calc(100vh - 220px))',
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
  }),
  table: css({
    tableLayout: 'fixed',
    borderCollapse: 'separate',
    borderSpacing: 0,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.5,
    'th, td': {
      padding: theme.spacing(0.5, 1),
      textAlign: 'left',
      verticalAlign: 'top',
      borderBottom: `1px solid ${theme.colors.border.weak}`,
      wordBreak: 'break-word',
    },
    th: {
      position: 'sticky',
      top: 0,
      zIndex: 2,
      background: theme.colors.background.secondary,
      fontWeight: theme.typography.fontWeightMedium,
      whiteSpace: 'nowrap',
      paddingRight: theme.spacing(1.5),
    },
  }),
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
  row: css({
    '& > td': { position: 'relative' },
    '&:hover > td': { background: theme.colors.action.hover },
    '& > td:hover > div:last-child': { visibility: 'visible' },
  }),
  odd: css({ '& > td': { background: theme.colors.background.secondary } }),
  expandCell: css({ padding: `${theme.spacing(0.25, 0, 0, 0.5)} !important` }),
  level: {
    none: css({}),
    info: css({}),
    error: css({ '& > td:first-child': { boxShadow: `inset 3px 0 ${theme.colors.error.main}` } }),
    warning: css({ '& > td:first-child': { boxShadow: `inset 3px 0 ${theme.colors.warning.main}` } }),
    debug: css({ color: theme.colors.text.secondary }),
  },
  mono: css({ fontFamily: theme.typography.fontFamilyMonospace, fontSize: '0.95em' }),
  cellText: css({ cursor: 'text' }),
  clamp: css({
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    cursor: 'pointer',
  }),
  cellActions: css({
    position: 'absolute',
    top: 2,
    right: 2,
    display: 'flex',
    gap: 2,
    padding: 2,
    visibility: 'hidden',
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
    boxShadow: theme.shadows.z2,
  }),
  badge: css({
    display: 'inline-block',
    padding: theme.spacing(0, 0.75),
    borderRadius: theme.shape.radius.default,
    fontSize: '0.9em',
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: 1.6,
  }),
  badgeLevel: {
    none: css({ background: theme.colors.background.secondary }),
    info: css({ background: theme.colors.primary.transparent, color: theme.colors.primary.text }),
    error: css({ background: theme.colors.error.transparent, color: theme.colors.error.text }),
    warning: css({ background: theme.colors.warning.transparent, color: theme.colors.warning.text }),
    debug: css({ background: theme.colors.action.selected, color: theme.colors.text.secondary }),
  },
  match: css({ '& > td': { background: `${theme.colors.action.selected} !important` } }),
  current: css({ outline: `2px solid ${theme.colors.primary.border}`, outlineOffset: -2 }),
  mark: css({
    background: theme.colors.warning.transparent,
    color: 'inherit',
    padding: 0,
    borderRadius: 2,
  }),
  empty: css({ color: theme.colors.text.secondary }),
  detailsRow: css({ '& > td': { background: theme.colors.background.canvas } }),
  details: css({
    position: 'sticky',
    left: EXPAND_WIDTH + 8,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.5, 0),
  }),
  detailsBar: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1) }),
  source: css({ flex: 1, color: theme.colors.text.secondary, wordBreak: 'break-all' }),
});
