import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { Virtualizer, useVirtualizer } from '@tanstack/react-virtual';
import { GrafanaTheme2 } from '@grafana/data';
import type { TimeZone } from '@grafana/schema';
import { Button, Checkbox, ClipboardButton, Icon, IconButton, Input, useStyles2 } from '@grafana/ui';
import { ColumnSettings, LogDetails, QueryResult, TableView } from '../../types';
import { copyWithToast } from '../../utils/clipboard';
import { downloadCsv, toCsv } from '../../utils/csv';
import { formatTime } from '../../utils/timeRange';
import {
  ValueFilters,
  estimateWidth,
  flattenMessage,
  fullLog,
  histogram,
  isMonoColumn,
  moveColumn,
  orderColumns,
  parseSort,
  passesFilters,
  queryFilter,
  rowMatches,
  searchClause,
  splitMatches,
  unloadedRange,
  valueCounts,
  valueFilterClause,
  visibleColumns,
} from '../../utils/table';
import { ColumnMenu } from './ColumnMenu';
import { ColumnsPicker } from './ColumnsPicker';
import { ExportChoice, ExportDialog } from './ExportDialog';
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
  /** Used in exported file names, e.g. the tab title. */
  exportName: string;
  /** The table's filters and search as Logs Insights clauses, for the editor to offer. */
  onFilterClauses: (clauses: string[]) => void;
  /** How the table was left last time, for the same result. */
  initialView?: TableView;
  /** Called when the table goes away (e.g. another tab is selected) with how it was left. */
  onSaveView?: (view: TableView) => void;
}

const EXPAND_WIDTH = 32;
const MIN_WIDTH = 48;
/** Room left for the column that takes up the remaining width. */
const FLEX_MIN_WIDTH = 240;
const LEVEL_FIELDS = ['severity', 'level', 'loglevel', 'log_level', 'lvl'];

type Level = 'error' | 'warning' | 'info' | 'debug' | undefined;
type Styles = ReturnType<typeof getStyles>;
type RowVirtualizer = Virtualizer<HTMLDivElement, Element>;

interface RowActions {
  toggleExpanded: (index: number) => void;
  toggleUnclamped: (index: number) => void;
  filterValue: (field: string, value: string, exclude: boolean) => void;
  filterByLogValue: (path: string, value: unknown, exclude: boolean) => void;
  addQueryFilter: (path: string, value: unknown, negate: boolean) => void;
}

/**
 * Work on a result that outlives the table: switching back to a tab mounts its table again, and
 * parsing every log or formatting every time again would make that slow. One value per name,
 * redone when its key (what else it depends on) changes.
 */
const resultCache = new WeakMap<QueryResult, Map<string, { key: string; value: unknown }>>();

/** Whether the element can scroll horizontally any further in the direction of deltaX. */
function canScrollX(el: HTMLElement, deltaX: number): boolean {
  if (el.scrollWidth <= el.clientWidth || !/auto|scroll/.test(getComputedStyle(el).overflowX)) {
    return false;
  }
  return deltaX < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
}

function cachedFor<T>(result: QueryResult, name: string, key: string, compute: () => T): T {
  let cache = resultCache.get(result);
  if (!cache) {
    cache = new Map();
    resultCache.set(result, cache);
  }
  const hit = cache.get(name);
  if (hit && hit.key === key) {
    return hit.value as T;
  }
  const value = compute();
  cache.set(name, { key, value });
  return value;
}

function toggled(set: Set<number>, index: number): Set<number> {
  const next = new Set(set);
  next.has(index) ? next.delete(index) : next.add(index);
  return next;
}

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

export function ResultsTable({
  result,
  timeZone,
  columns,
  onColumnsChange,
  onRunRange,
  onAddQueryFilter,
  exportName,
  onFilterClauses,
  initialView,
  onSaveView,
}: Props) {
  const s = useStyles2(getStyles);
  const [filters, setFilters] = useState<ValueFilters>(() => initialView?.filters ?? {});
  // Time window picked on the histogram; narrows the loaded rows without a new query.
  const [zoom, setZoom] = useState<{ from: number; to: number } | undefined>(() => initialView?.zoom);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState(() => initialView?.search ?? '');
  const [hideNonMatching, setHideNonMatching] = useState(() => initialView?.hideNonMatching ?? false);
  const [current, setCurrent] = useState(() => initialView?.current ?? 0);
  const [scrollRequest, setScrollRequest] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(() => initialView?.expanded ?? new Set());
  // Rows whose long cells are shown in full instead of clamped to two lines.
  const [unclamped, setUnclamped] = useState<Set<number>>(() => initialView?.unclamped ?? new Set());
  const [draftWidths, setDraftWidths] = useState<Record<string, number>>();
  // State rather than a ref: the rows' virtualizer needs it, and mounts before a ref would be set.
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  // Kept out of state: scrolling should not re-render the table.
  const scrollPosition = useRef({ top: initialView?.scrollTop ?? 0, left: initialView?.scrollLeft ?? 0 });
  const [viewWidth, setViewWidth] = useState(0);

  // Expanded details are pinned to the visible part of a wide table, so they need its width.
  useEffect(() => {
    const el = scrollElement;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(() => setViewWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollElement]);

  // A sideways swipe the table cannot scroll any further would go to the browser as back/forward.
  useEffect(() => {
    const el = scrollElement;
    if (!el) {
      return;
    }
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) {
        return;
      }
      for (let node = e.target as HTMLElement | null; node; node = node.parentElement) {
        if (canScrollX(node, e.deltaX)) {
          return;
        }
        if (node === el) {
          break;
        }
      }
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scrollElement]);

  // Time fields arrive as epoch millis; show them in the selected zone.
  // Leaves of each JSON log event by dotted path: candidates for extra columns and table filters.
  // Cached per result, not just memoized: the table is mounted again each time its tab is shown.
  const rawFlat = useMemo(
    () => cachedFor(result, 'rawFlat', '', () => result.details.map((d) => flattenMessage(d.message))),
    [result]
  );
  const rawKeys = useMemo(
    () =>
      cachedFor(result, 'rawKeys', '', () => {
        const counts = new Map<string, number>();
        rawFlat.forEach((row) => Object.keys(row).forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1)));
        return Array.from(counts, ([name, count]) => ({ name, count }))
          .filter((k) => !result.fields.includes(k.name))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      }),
    [rawFlat, result]
  );

  // Query fields plus the ones added from the raw log.
  const extra = useMemo(
    () => (columns.extra ?? []).filter((f) => !result.fields.includes(f)),
    [columns.extra, result.fields]
  );
  const fields = useMemo(() => [...result.fields, ...extra], [result.fields, extra]);

  const displayKey = `${timeZone}\n${extra.join('\n')}`;
  const displayRows = useMemo(
    () =>
      cachedFor(result, 'displayRows', displayKey, () =>
        result.rows.map((row, i) => {
          const out = { ...row };
          for (const f of extra) {
            if (rawFlat[i][f] !== undefined) {
              out[f] = rawFlat[i][f];
            }
          }
          for (const f of result.timeFields) {
            if (out[f] !== undefined) {
              out[f] = formatTime(Number(out[f]), timeZone, 'YYYY-MM-DD HH:mm:ss.SSS');
            }
          }
          return out;
        })
      ),
    [result, displayKey, timeZone, extra, rawFlat]
  );

  const cols = useMemo(() => visibleColumns(fields, columns), [fields, columns]);
  const needle = search.trim().toLowerCase();
  const levelField = fields.find((f) => LEVEL_FIELDS.includes(f.toLowerCase()));

  // Per column: starting width from content, and whether it holds ids/numbers/times.
  const columnInfo = useMemo(
    () =>
      cachedFor(result, 'columnInfo', displayKey, () => {
        const info: Record<string, { width: number; mono: boolean }> = {};
        for (const f of fields) {
          const values = displayRows.map((r) => r[f] ?? '');
          info[f] = { width: estimateWidth(f, values), mono: result.timeFields.includes(f) || isMonoColumn(values) };
        }
        return info;
      }),
    [result, displayKey, displayRows, fields]
  );

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
    const toPoints = (indexes: number[]) =>
      indexes.flatMap((i) => {
        const time = result.details[i]?.timestamp;
        const level = rowLevel(displayRows[i], levelField);
        return time === undefined ? [] : [{ time, group: level === 'info' || !level ? 'other' : level }];
      });
    // Every loaded row in the view, whatever the filters and search say: drawn faintly behind the
    // bars so filtering does not lose the overall picture.
    const inView = displayRows.flatMap((_, i) => (inZoom[i] ? [i] : []));
    const all = toPoints(inView);
    if (all.length === 0 && !zoom) {
      return undefined;
    }
    // Keep bars about as wide as on a full axis when they only cover part of it.
    const share = (loaded.to - loaded.from) / Math.max(1, view.to - view.from);
    const count = Math.max(1, Math.min(60, Math.round(60 * share)));
    const bin = (points: typeof all) =>
      loaded.to > loaded.from ? histogram(points, loaded.from, loaded.to, count) : [];
    const filtering = rows.length < inView.length;
    return { view, gap, bins: bin(toPoints(rows)), ghost: filtering ? bin(all) : undefined };
  }, [rows, result, displayRows, levelField, zoom, unloaded, inZoom]);

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

  // Lives in TableRows, so scrolling re-renders only the rows; read here for search and saving.
  const virtualizer = useRef<RowVirtualizer | null>(null);

  // Hand back how the table was left, read from refs so it is the latest when the table goes away.
  const latestView = useRef<(() => TableView) | null>(null);
  const saveView = useRef(onSaveView);
  useLayoutEffect(() => {
    latestView.current = () => ({
      filters,
      zoom,
      search,
      hideNonMatching,
      current,
      expanded,
      unclamped,
      scrollTop: scrollPosition.current.top,
      scrollLeft: scrollPosition.current.left,
      measurements: virtualizer.current?.takeSnapshot(),
    });
    saveView.current = onSaveView;
  });
  useEffect(() => () => saveView.current?.(latestView.current!()), []);

  useEffect(() => {
    // Nothing asked yet: a restored search keeps the restored scroll position.
    if (scrollRequest === 0) {
      return;
    }
    if (currentRow !== undefined) {
      const position = rows.indexOf(currentRow);
      if (position >= 0) {
        virtualizer.current?.scrollToIndex(position, { align: 'center' });
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

  // Filters and search, written as query clauses. Time columns are left out: their cells hold
  // formatted dates that a query cannot compare against.
  const clauses = useMemo(() => {
    const out = Object.entries(filters)
      .filter(([field]) => !result.timeFields.includes(field))
      .map(([field, allowed]) => {
        const values = displayRows.map((r) => r[field] ?? '');
        const numeric = values.every((v) => v === '' || /^-?\d+(\.\d+)?$/.test(v));
        return valueFilterClause(field, allowed, values, numeric);
      });
    const searched = cols.filter((f) => !result.timeFields.includes(f));
    if (needle && hideNonMatching && searched.length > 0) {
      out.push(searchClause(search.trim(), searched));
    }
    return out;
  }, [filters, displayRows, result.timeFields, cols, needle, hideNonMatching, search]);
  const clausesKey = clauses.join('\n');
  useEffect(() => {
    onFilterClauses(clausesKey ? clausesKey.split('\n') : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clausesKey]);
  // A new result (or closing the tab's results) starts without table filters.
  useEffect(() => () => onFilterClauses([]), [onFilterClauses]);

  const filterValue = (field: string, value: string, exclude: boolean) => {
    if (!exclude) {
      setFilter(field, new Set([value]));
      return;
    }
    // The field may have just been added from the raw log and not be in displayRows yet.
    const allowed = new Set(filters[field] ?? displayRows.map((r, i) => r[field] ?? rawFlat[i][field] ?? ''));
    allowed.delete(value);
    setFilter(field, allowed);
  };

  // A JSON value filters the table like a cell does; its field becomes a column so the filter shows.
  const filterByLogValue = (path: string, value: unknown, exclude: boolean) => {
    if (!fields.includes(path) || columns.hidden?.includes(path)) {
      onColumnsChange({
        ...columns,
        extra: fields.includes(path) ? columns.extra : [...extra, path],
        hidden: (columns.hidden ?? []).filter((f) => f !== path),
      });
    }
    filterValue(path, value === null || value === undefined ? '' : String(value), exclude);
  };

  // What rows can do, behind a ref that always holds the latest handlers: rows are memoized and
  // must not re-render just because these closures are new.
  const rowActions = useRef<RowActions | null>(null);
  useLayoutEffect(() => {
    rowActions.current = {
      toggleExpanded: (index) => setExpanded((set) => toggled(set, index)),
      toggleUnclamped: (index) => setUnclamped((set) => toggled(set, index)),
      filterValue,
      filterByLogValue,
      addQueryFilter: (path, value, negate) => onAddQueryFilter(queryFilter(path, value, negate)),
    };
  });
  // Read while rendering open rows, so a prop rather than one of the actions set after rendering.
  const canFilterTable = useCallback(
    (path: string) => fields.includes(path) || rawKeys.some((k) => k.name === path),
    [fields, rawKeys]
  );

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
    const order = orderColumns(fields, columns);
    const target = cols[cols.indexOf(field) + offset];
    if (target) {
      onColumnsChange({ ...columns, order: moveColumn(order, field, order.indexOf(target) - order.indexOf(field)) });
    }
  };

  const exportCsv = ({ rows: which, fields }: ExportChoice) => {
    const indexes = which === 'shown' ? rows : displayRows.map((_, i) => i);
    // Raw parts of the log event come from the row details; the rest are table values as shown.
    const data = indexes.map((i) => ({
      '@message': result.details[i]?.message,
      '@log': result.details[i]?.logGroup,
      '@logStream': result.details[i]?.logStream,
      ...displayRows[i],
    }));
    const header = fields;
    const stamp = formatTime(Date.now(), timeZone, 'YYYYMMDD-HHmmss');
    const safeName = exportName.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'logs';
    downloadCsv(`${safeName}-${stamp}.csv`, toCsv(header, data));
    setExporting(false);
  };

  const filterCount = Object.keys(filters).length;
  const total = result.rows.length;
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
          ghost={histo.ghost}
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
        <Button size="sm" variant="secondary" icon="download-alt" onClick={() => setExporting(true)}>
          Export CSV
        </Button>
        {exporting && (
          <ExportDialog
            shownCount={rows.length}
            totalCount={total}
            allFields={orderColumns(fields, columns)}
            visibleFields={cols}
            onExport={exportCsv}
            onDismiss={() => setExporting(false)}
          />
        )}
        <ColumnsPicker
          fields={fields}
          extra={extra}
          rawKeys={rawKeys}
          rowCount={total}
          settings={columns}
          onChange={onColumnsChange}
        />
      </div>

      <div
        className={s.scroll}
        ref={setScrollElement}
        onScroll={(e) => {
          scrollPosition.current = { top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft };
        }}
      >
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
          <TableRows
            s={s}
            scrollElement={scrollElement}
            virtualizerRef={virtualizer}
            initialOffset={initialView?.scrollTop ?? 0}
            initialLeft={initialView?.scrollLeft ?? 0}
            initialMeasurements={initialView?.measurements}
            rows={rows}
            displayRows={displayRows}
            rawRows={result.rows}
            details={result.details}
            cols={cols}
            columnInfo={columnInfo}
            levelField={levelField}
            needle={needle}
            matchSet={matchSet}
            currentRow={currentRow}
            expanded={expanded}
            unclamped={unclamped}
            viewWidth={viewWidth}
            actions={rowActions}
            canFilterTable={canFilterTable}
            emptyText={total === 0 ? 'No rows' : 'No rows match the current filters'}
          />
        </table>
      </div>
    </div>
  );
}

interface TableRowsProps {
  s: Styles;
  scrollElement: HTMLDivElement | null;
  /** Filled with the virtualizer, for the table to scroll to search matches and save measurements. */
  virtualizerRef: React.MutableRefObject<RowVirtualizer | null>;
  initialOffset: number;
  initialLeft: number;
  initialMeasurements?: TableView['measurements'];
  /** Indexes into displayRows, in display order. */
  rows: number[];
  displayRows: Array<Record<string, string>>;
  /** Rows as the query returned them, for copying values as they are. */
  rawRows: Array<Record<string, string>>;
  details: LogDetails[];
  cols: string[];
  columnInfo: Record<string, { width: number; mono: boolean }>;
  levelField?: string;
  needle: string;
  matchSet: Set<number>;
  currentRow?: number;
  expanded: Set<number>;
  unclamped: Set<number>;
  viewWidth: number;
  actions: React.RefObject<RowActions | null>;
  canFilterTable: (path: string) => boolean;
  emptyText: string;
}

/**
 * The rows on screen. Owns the virtualizer, so a scroll re-renders this and not the whole table
 * (histogram, toolbar, headers); rows already on screen are memoized and skip re-rendering.
 */
const TableRows = React.memo(function TableRows({
  s,
  scrollElement,
  virtualizerRef,
  initialOffset,
  initialLeft,
  initialMeasurements,
  rows,
  displayRows,
  rawRows,
  details,
  cols,
  columnInfo,
  levelField,
  needle,
  matchSet,
  currentRow,
  expanded,
  unclamped,
  viewWidth,
  actions,
  canFilterTable,
  emptyText,
}: TableRowsProps) {
  // No React Compiler here anyway; the virtualizer is re-read on every render by design.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => 34,
    overscan: 12,
    getItemKey: (i) => rows[i],
    initialOffset,
    initialMeasurementsCache: initialMeasurements,
    // Rows on the very first render, before the scroll area is measured. Without them the page
    // gets shorter for a moment when a tab is shown, and the browser scrolls it up.
    initialRect: { width: 0, height: window.innerHeight },
  });
  virtualizerRef.current = virtualizer;

  const items = virtualizer.getVirtualItems();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;

  // Back to where the table was scrolled when it was last shown. The first render has no rows yet
  // (the virtualizer has not measured the scroll area), so wait until they are on the page.
  const scrollRestored = useRef(false);
  useLayoutEffect(() => {
    const el = scrollElement;
    if (scrollRestored.current || !el || (rows.length > 0 && items.length === 0)) {
      return;
    }
    scrollRestored.current = true;
    el.scrollTop = initialOffset;
    el.scrollLeft = initialLeft;
  });

  return (
    <>
      {padTop > 0 && (
        <tbody>
          <tr style={{ height: padTop }} />
        </tbody>
      )}
      {items.map((item) => {
        const index = rows[item.index];
        const isMatch = matchSet.has(index);
        const isOpen = expanded.has(index);
        return (
          <LogRow
            key={item.key}
            s={s}
            position={item.index}
            index={index}
            measure={virtualizer.measureElement}
            row={displayRows[index]}
            rawRow={rawRows[index]}
            details={details[index]}
            cols={cols}
            columnInfo={columnInfo}
            levelField={levelField}
            needle={isMatch ? needle : ''}
            isCurrent={index === currentRow}
            isOpen={isOpen}
            isUnclamped={unclamped.has(index)}
            detailsWidth={isOpen ? viewWidth - EXPAND_WIDTH - 24 : 0}
            actions={actions}
            canFilterTable={canFilterTable}
          />
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
              {emptyText}
            </td>
          </tr>
        </tbody>
      )}
    </>
  );
});

interface LogRowProps {
  s: Styles;
  /** Place in the shown rows, for the virtualizer and striping. */
  position: number;
  /** Index into the result's rows. */
  index: number;
  measure: (el: Element | null) => void;
  row: Record<string, string>;
  rawRow: Record<string, string>;
  details?: LogDetails;
  cols: string[];
  columnInfo: Record<string, { width: number; mono: boolean }>;
  levelField?: string;
  /** Search text when this row matches it, else empty. */
  needle: string;
  isCurrent: boolean;
  isOpen: boolean;
  isUnclamped: boolean;
  detailsWidth: number;
  actions: React.RefObject<RowActions | null>;
  canFilterTable: (path: string) => boolean;
}

const LogRow = React.memo(function LogRow({
  s,
  position,
  index,
  measure,
  row,
  rawRow,
  details,
  cols,
  columnInfo,
  levelField,
  needle,
  isCurrent,
  isOpen,
  isUnclamped,
  detailsWidth,
  actions,
  canFilterTable,
}: LogRowProps) {
  // Cell actions are buttons with tooltips, costly to mount for every cell scrolled past, so they
  // are only rendered for the row under the mouse.
  const [hovered, setHovered] = useState(false);
  const level = rowLevel(row, levelField);
  const act = () => actions.current!;

  const highlight = (text: string) =>
    needle
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

  return (
    <tbody data-index={position} ref={measure}>
      <tr
        className={cx(
          s.row,
          position % 2 === 1 && s.odd,
          s.level[level ?? 'none'],
          needle && s.match,
          isCurrent && s.current
        )}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <td className={s.expandCell} onClick={() => act().toggleExpanded(index)}>
          <button
            type="button"
            className={cx(s.expandButton, isOpen && s.expandOpen)}
            aria-label="Toggle row details"
            aria-expanded={isOpen}
            title={isOpen ? 'Hide the log' : 'Show the whole log'}
          >
            <Chevron />
          </button>
        </td>
        {cols.map((f) => {
          const value = row[f] ?? '';
          return (
            <td key={f} className={cx(columnInfo[f]?.mono && s.mono)}>
              <div
                className={cx(s.cellText, !isUnclamped && s.clamp)}
                onClick={() => {
                  // Clicking expands long text; selecting text to copy should not.
                  if (!window.getSelection()?.toString()) {
                    act().toggleUnclamped(index);
                  }
                }}
              >
                {f === levelField && value ? (
                  <span className={cx(s.badge, s.badgeLevel[level ?? 'none'])}>{highlight(value)}</span>
                ) : (
                  highlight(value)
                )}
              </div>
              {value && hovered && (
                <div className={s.cellActions}>
                  <IconButton
                    name="search-plus"
                    size="sm"
                    tooltip="Show only this value"
                    onClick={() => act().filterValue(f, value, false)}
                  />
                  <IconButton
                    name="search-minus"
                    size="sm"
                    tooltip="Hide this value"
                    onClick={() => act().filterValue(f, value, true)}
                  />
                  <IconButton
                    name="copy"
                    size="sm"
                    tooltip="Copy value"
                    onClick={() => copyWithToast(rawRow[f] ?? value)}
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
              width={detailsWidth}
              log={fullLog(row, details)}
              logGroup={details?.logGroup}
              logStream={details?.logStream}
              canFilterTable={canFilterTable}
              onTableFilter={(path, value, exclude) => act().filterByLogValue(path, value, exclude)}
              onQueryFilter={(path, value, negate) => act().addQueryFilter(path, value, negate)}
            />
          </td>
        </tr>
      )}
    </tbody>
  );
});

/** The row toggle's chevron, drawn inline: an Icon per row is noticeably slower to mount. */
function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M14.83 11.29 10.59 7.05a1 1 0 0 0-1.42 0 1 1 0 0 0 0 1.41L12.71 12l-3.54 3.54a1 1 0 0 0 0 1.41 1 1 0 0 0 .71.29 1 1 0 0 0 .71-.29l4.24-4.24a1 1 0 0 0 0-1.42Z" />
    </svg>
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
  canFilterTable: (path: string) => boolean;
  onTableFilter: (path: string, value: unknown, exclude: boolean) => void;
  onQueryFilter: (path: string, value: unknown, negate: boolean) => void;
}

function LogDetailsView({
  width,
  log,
  logGroup,
  logStream,
  canFilterTable,
  onTableFilter,
  onQueryFilter,
}: LogDetailsProps) {
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
      <JsonTree
        value={log}
        canFilterTable={canFilterTable}
        onTableFilter={onTableFilter}
        onQueryFilter={onQueryFilter}
      />
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
    overscrollBehaviorX: 'none',
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
    // The column menu renders inside the header cell (no portal in this @grafana/ui),
    // so lift the cell above the sticky toolbar while its menu is open.
    'th:has([aria-expanded="true"])': { zIndex: 4 },
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
  // The whole first cell toggles the row; the chevron sits in the middle of tall rows and turns
  // down when the log is open.
  expandCell: css({
    padding: `${theme.spacing(0, 0, 0, 0.5)} !important`,
    verticalAlign: 'middle !important',
    cursor: 'pointer',
  }),
  expandButton: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    padding: 0,
    border: `1px solid transparent`,
    borderRadius: theme.shape.radius.default,
    background: 'transparent',
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    transition: 'transform 0.15s ease, background 0.15s ease',
    'tr:hover &': { color: theme.colors.text.primary, borderColor: theme.colors.border.medium },
    '&:hover': { background: theme.colors.action.hover },
  }),
  expandOpen: css({
    transform: 'rotate(90deg)',
    color: `${theme.colors.primary.text} !important`,
    borderColor: `${theme.colors.primary.border} !important`,
  }),
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
