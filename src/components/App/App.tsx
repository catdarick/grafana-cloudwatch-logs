import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css, cx, keyframes } from '@emotion/css';
import { AppRootProps, GrafanaTheme2, PageLayoutType, colorManipulator } from '@grafana/data';
import { DataSourcePicker, PluginPage, config, getDataSourceSrv, locationService } from '@grafana/runtime';
import { Alert, Button, IconName, RadioButtonGroup, TimeZonePicker, Tooltip, useStyles2 } from '@grafana/ui';
import { cancelQuery, estimateScan, fetchLogGroupFields, runLogsQuery } from '../../api/cloudwatch';
import { QueryProblem, formatProblem, lintQuery } from '../../language/lint';
import { addQueryStage } from '../../language/parse';
import { knownRawFields, useRawFieldHistory } from '../../state/rawFieldHistory';
import { useTableViews } from '../../state/tableViews';
import { useWorkspace } from '../../state/useWorkspace';
import { DEFAULT_REGION, PLUGIN_BASE_URL, PLUGIN_ID } from '../../constants';
import { AppSettings, QueryResult, TimeRangeValue } from '../../types';
import { copyWithToast } from '../../utils/clipboard';
import { errorMessage } from '../../utils/errors';
import { DEFAULT_COST_PER_GB, estimateCost, formatCost } from '../../utils/cost';
import { SHARE_PARAM_KEYS, fromShareParams, toShareParams } from '../../utils/shareLink';
import { formatTime, isValidRange, toEpochRange, zoneLabel } from '../../utils/timeRange';
import { LogGroups } from '../LogGroups/LogGroups';
import { QueryEditor } from '../QueryEditor/QueryEditor';
import { RESULTS_SCROLL, ResultsTable } from '../Results/ResultsTable';
import { QueryTabs } from '../Tabs/QueryTabs';
import { TimeRangePicker } from '../TimeRangePicker/TimeRangePicker';
import { testIds } from '../testIds';

/** What Grafana 10.4 answers with instead of the data source's own error. */
const GENERIC_PLUGIN_ERROR = 'An error occurred within the plugin';

/** CloudWatch's estimate of what a tab's query would scan, for the inputs in `key`. */
interface ScanEstimateState {
  /** Query, log groups, time range and data source it was made for. */
  key: string;
  /** The same without the query: tells a query edit from other changes. */
  inputs: string;
  running?: boolean;
  /** While running: the previous estimate, shown faded until the new one comes. */
  bytes?: number;
  error?: string;
}

/** After a change of log groups, range or data source. */
const ESTIMATE_DELAY = 800;
/** After an edit of the query, unless the editor loses focus first. */
const QUERY_ESTIMATE_DELAY = 5000;

function defaultDatasourceUid(settings: AppSettings): string | undefined {
  return settings.datasourceUid || getDataSourceSrv().getList({ type: 'cloudwatch' })[0]?.uid;
}

function App({ meta }: AppRootProps<AppSettings>) {
  const s = useStyles2(getStyles);
  const settings = meta.jsonData ?? {};
  const ws = useWorkspace();
  const tab = ws.activeTab;

  const [datasourceUid, setDatasourceUid] = useState(() => defaultDatasourceUid(settings));
  const [results, setResults] = useState<Record<string, QueryResult | undefined>>({});
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [runError, setRunError] = useState<Record<string, string | undefined>>({});
  // Runs per tab: only the latest one of a tab may set its result.
  const runCount = useRef<Record<string, number>>({});
  // Table filters of the active tab's results as query clauses, offered as ghost lines in the editor.
  const [tableClauses, setTableClauses] = useState<string[]>([]);
  // With the query staying on top: hides log groups and the editor so the results get the whole page.
  const [focusResults, setFocusResults] = useState(false);
  const [discoveredFields, setDiscoveredFields] = useState<Record<string, string[]>>({});
  // Search, filters, zoom and scroll of each tab's table, so switching tabs does not lose them.
  const tableViews = useTableViews();
  // Field names from the raw JSON logs of each group's last queries, kept across reloads.
  const rawFields = useRawFieldHistory();

  // A shared link opens its query in a tab once; the params are then dropped so a reload keeps the workspace.
  useEffect(() => {
    const shared = fromShareParams(new URLSearchParams(locationService.getLocation().search));
    if (!shared) {
      return;
    }
    ws.openShared(shared);
    if (shared.datasourceUid && getDataSourceSrv().getInstanceSettings(shared.datasourceUid)) {
      setDatasourceUid(shared.datasourceUid);
    }
    locationService.partial(Object.fromEntries(SHARE_PARAM_KEYS.map((k) => [k, null])), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autocomplete: fields CloudWatch has seen in the selected groups, fields of their raw logs from
  // recent queries, plus fields from earlier results.
  useEffect(() => {
    if (!datasourceUid) {
      return;
    }
    for (const group of tab.logGroups) {
      const key = `${group.region}:${group.name}`;
      if (discoveredFields[key]) {
        continue;
      }
      fetchLogGroupFields(datasourceUid, group)
        .then((fields) => setDiscoveredFields((d) => ({ ...d, [key]: fields })))
        .catch(() => setDiscoveredFields((d) => ({ ...d, [key]: [] })));
    }
  }, [datasourceUid, tab.logGroups, discoveredFields]);

  const completionFields = useMemo(() => {
    const names = new Set<string>();
    tab.logGroups.forEach((g) => discoveredFields[`${g.region}:${g.name}`]?.forEach((f) => names.add(f)));
    knownRawFields(rawFields.history, tab.logGroups).forEach((f) => names.add(f));
    Object.values(results).forEach((r) => r?.fields.forEach((f) => names.add(f)));
    return Array.from(names).sort();
  }, [tab.logGroups, discoveredFields, rawFields.history, results]);

  const defaultRegion = settings.defaultRegion || DEFAULT_REGION;

  const requestId = (id: string) => `cloudwatch-logs-app-${id}`;
  const estimateId = (id: string) => `cloudwatch-logs-app-estimate-${id}`;
  const canRun =
    Boolean(datasourceUid) && tab.logGroups.length > 0 && tab.query.trim() !== '' && isValidRange(tab.timeRange);
  const costPerGb = settings.costPerGb ?? DEFAULT_COST_PER_GB;

  // What the query would scan, estimated by CloudWatch (free) once the inputs stop changing: shortly
  // after a change of log groups, range or data source; after a longer pause in typing the query, or
  // when the editor loses focus. A query with syntax errors is not sent: it would only fail.
  const [estimates, setEstimates] = useState<Record<string, ScanEstimateState | undefined>>({});
  const estimateInputs = JSON.stringify([
    tab.logGroups.map((g) => `${g.region}:${g.name}`),
    tab.timeRange,
    datasourceUid,
  ]);
  const estimateKey = JSON.stringify([tab.query, estimateInputs]);
  const queryHasErrors = useMemo(() => lintQuery(tab.query).some((p) => p.severity === 'error'), [tab.query]);
  const canEstimate = canRun && !queryHasErrors;
  const estimateState = estimates[tab.id];
  const estimateFresh = estimateState?.key === estimateKey;
  const onlyQueryChanged = estimateState?.inputs === estimateInputs;

  /** Asks CloudWatch what the active tab's query would scan, without running it. */
  const runEstimate = async () => {
    if (!datasourceUid || !canEstimate) {
      return;
    }
    const tabId = tab.id;
    const key = estimateKey;
    const inputs = estimateInputs;
    const keep = (next: ScanEstimateState) =>
      setEstimates((e) => (e[tabId]?.key === key ? { ...e, [tabId]: next } : e));
    setEstimates((e) => ({ ...e, [tabId]: { key, inputs, running: true, bytes: e[tabId]?.bytes } }));
    try {
      const bytes = await estimateScan({
        datasourceUid,
        requestId: estimateId(tabId),
        query: tab.query,
        logGroups: tab.logGroups,
        ...toEpochRange(tab.timeRange),
      });
      keep({ key, inputs, bytes });
    } catch (e) {
      // Cancelled: a newer estimate of the tab took its place.
      if (!isCancelled(e)) {
        keep({ key, inputs, error: errorMessage(e) });
      }
    }
  };
  const runEstimateRef = useRef(runEstimate);
  runEstimateRef.current = runEstimate;
  useEffect(() => {
    if (!canEstimate || estimateFresh) {
      return;
    }
    const delay = onlyQueryChanged ? QUERY_ESTIMATE_DELAY : ESTIMATE_DELAY;
    const timer = setTimeout(() => runEstimateRef.current(), delay);
    return () => clearTimeout(timer);
  }, [canEstimate, estimateFresh, estimateKey, onlyQueryChanged]);
  // Done editing the query: no need to wait out the delay.
  const estimateNow = () => {
    if (canEstimate && !estimateFresh) {
      runEstimate();
    }
  };

  /** Runs the active tab; overrides cover changes made in the same click, before state has updated. */
  const run = async (override: { query?: string; timeRange?: TimeRangeValue } = {}) => {
    if (!datasourceUid || !canRun) {
      return;
    }
    const tabId = tab.id;
    const runId = (runCount.current[tabId] ?? 0) + 1;
    runCount.current[tabId] = runId;
    const latest = () => runCount.current[tabId] === runId;
    const logGroups = tab.logGroups;
    const query = override.query ?? tab.query;
    const { from, to } = toEpochRange(override.timeRange ?? tab.timeRange);
    setRunning((r) => ({ ...r, [tabId]: true }));
    setRunError((e) => ({ ...e, [tabId]: undefined }));
    try {
      const result = await runLogsQuery({
        datasourceUid,
        requestId: requestId(tabId),
        query,
        logGroups,
        from,
        to,
      });
      if (!latest()) {
        return;
      }
      setResults((r) => ({ ...r, [tabId]: result }));
      if (!result.error) {
        // After the table has rendered: this parses every message once more.
        setTimeout(() => rawFields.record(logGroups, result.details));
      }
    } catch (e) {
      if (latest() && !isCancelled(e)) {
        setRunError((errs) => ({ ...errs, [tabId]: errorMessage(e) }));
      }
    } finally {
      if (latest()) {
        setRunning((r) => ({ ...r, [tabId]: false }));
      }
    }
  };

  const result = results[tab.id];

  const copyLink = (fixedTime: boolean) => {
    // A fixed link pins what was last run in this tab, so the recipient sees the same rows.
    const timeRange =
      fixedTime && tab.timeRange.mode === 'relative'
        ? {
            mode: 'absolute' as const,
            ...(result ? { from: result.from, to: result.to } : toEpochRange(tab.timeRange)),
          }
        : tab.timeRange;
    const params = toShareParams({ query: tab.query, logGroups: tab.logGroups, timeRange, datasourceUid });
    const url = `${window.location.origin}${config.appSubUrl}${PLUGIN_BASE_URL}?${params}`;
    copyWithToast(url, 'Link copied');
  };

  const error = runError[tab.id] ?? result?.error;
  // Grafana 10.4 replaces CloudWatch's error text (a syntax error, say) with a generic one; say what
  // our own check finds in the query instead.
  const genericError = error === GENERIC_PLUGIN_ERROR;
  const problems = useMemo(() => (genericError ? lintQuery(tab.query) : []), [genericError, tab.query]);
  const errors = problems.filter((p) => p.severity === 'error');
  // Unknown words and what is valid but often a mistake: likely, not certain.
  const possible = problems.filter((p) => p.severity !== 'error');
  const failed = Object.fromEntries(ws.state.tabs.map((t) => [t.id, Boolean(runError[t.id] ?? results[t.id]?.error)]));

  const zoomTo = (from: number, to: number) => {
    const timeRange: TimeRangeValue = { mode: 'absolute', from: Math.floor(from), to: Math.ceil(to) };
    ws.updateTab(tab.id, { timeRange });
    run({ timeRange });
  };

  const addQueryFilter = (clause: string) => {
    const query = addQueryStage(tab.query, clause);
    ws.updateTab(tab.id, { query });
    run({ query });
  };

  // Auto-expand: the page and the results table scroll as one (see scrollAsOne). Off: the table only
  // gets the space under the query part, and scrolls on its own.
  const autoExpand = ws.state.autoExpand ?? false;
  // Scrolling away does what Expand results does, so the button (and what it hid) is for the other layout.
  const hideQuery = !autoExpand && focusResults;
  const pageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const page = pageRef.current;
    if (!page || !autoExpand) {
      return;
    }
    const onWheel = (e: WheelEvent) => scrollAsOne(e, page);
    page.addEventListener('wheel', onWheel, { passive: false });
    return () => page.removeEventListener('wheel', onWheel);
  }, [autoExpand]);

  return (
    <PluginPage layout={PageLayoutType.Canvas}>
      <div ref={pageRef} className={cx(s.page, autoExpand && s.pageAuto)} data-testid={testIds.app.container}>
        <div className={s.topBar}>
          <QueryTabs
            tabs={ws.state.tabs}
            activeTabId={tab.id}
            results={results}
            running={running}
            failed={failed}
            onSelect={ws.selectTab}
            onClose={(id) => {
              cancelQuery(requestId(id));
              cancelQuery(estimateId(id));
              tableViews.forget(id);
              ws.closeTab(id);
            }}
            onAdd={() => ws.addTab(tab)}
            onRename={(id, title) => ws.updateTab(id, { title })}
          />
          <div title="Time zone for absolute times and results">
            <TimeZonePicker
              includeInternal
              width={28}
              value={ws.state.timeZone}
              onChange={(tz) => ws.setTimeZone(tz ?? 'utc')}
            />
          </div>
          <DataSourcePicker
            pluginId="cloudwatch"
            current={datasourceUid ?? null}
            width={28}
            onChange={(ds) => setDatasourceUid(ds.uid)}
          />
        </div>

        {!hideQuery && (
          <>
            <LogGroups
              key={`${tab.id}:${defaultRegion}`}
              datasourceUid={datasourceUid}
              defaultRegion={defaultRegion}
              selected={tab.logGroups}
              favorites={ws.state.favorites}
              onSelectedChange={(logGroups) => ws.updateTab(tab.id, { logGroups })}
              onToggleFavorite={ws.toggleFavorite}
            />

            <div className={s.editorRow}>
              <QueryEditor
                key={tab.id}
                query={tab.query}
                fields={completionFields}
                savedQueryName={tab.savedQueryName}
                savedQueries={ws.state.savedQueries}
                onChange={(query, savedQueryName) => ws.updateTab(tab.id, { query, savedQueryName })}
                onRun={() => run()}
                onSave={ws.saveQuery}
                onDelete={ws.deleteQuery}
                pendingFilters={tableClauses.filter((c) => !tab.query.includes(c))}
                onApplyFilter={(clause) => ws.updateTab(tab.id, { query: addQueryStage(tab.query, clause) })}
                relativeTime={tab.timeRange.mode === 'relative'}
                onCopyLink={copyLink}
                showHints={genericError}
                onBlur={estimateNow}
              />
              <section className={s.timeColumn}>
                <TimeRangePicker
                  key={tab.id}
                  value={tab.timeRange}
                  timeZone={ws.state.timeZone}
                  onChange={(timeRange) => ws.updateTab(tab.id, { timeRange })}
                />
                {running[tab.id] ? (
                  <Button
                    size="lg"
                    variant="destructive"
                    icon="square-shape"
                    fullWidth
                    className={s.runButton}
                    onClick={() => cancelQuery(requestId(tab.id))}
                  >
                    Stop
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    icon="play"
                    fullWidth
                    className={s.runButton}
                    disabled={!canRun}
                    onClick={() => run()}
                    tooltip={
                      <RunTooltip
                        bytes={estimateFresh && !estimateState?.running ? estimateState?.bytes : undefined}
                        error={estimateFresh ? estimateState?.error : undefined}
                        updating={canEstimate && (!estimateFresh || Boolean(estimateState?.running))}
                        costPerGb={costPerGb}
                      />
                    }
                  >
                    <span className={s.runLabel}>
                      <span>Run query</span>
                      {/* Faded while it is not for the current inputs; a wave while CloudWatch is asked. */}
                      {canEstimate && (estimateState?.bytes !== undefined || estimateState?.running) && (
                        <span className={cx(s.runEstimate, estimateState?.running && s.runEstimateWave)}>
                          <span
                            className={cx(
                              (!estimateFresh || estimateState?.running) && s.runEstimateStale,
                              estimateState?.bytes === undefined && s.runEstimatePlaceholder
                            )}
                          >
                            {estimateState?.bytes !== undefined
                              ? scanText(estimateState.bytes, costPerGb)
                              : '≈ 00 MB · $0.0000'}
                          </span>
                        </span>
                      )}
                    </span>
                  </Button>
                )}
                {tab.logGroups.length === 0 && <span className={s.hint}>Select at least one log group</span>}
              </section>
            </div>
          </>
        )}

        {error && (
          <Alert severity="error" title="Query failed">
            {!genericError ? (
              error
            ) : problems.length > 0 ? (
              <>
                <div>Grafana does not pass on CloudWatch&apos;s error message.</div>
                <ProblemList title="The query has these errors:" problems={errors} className={s.problems} />
                <ProblemList
                  title={errors.length > 0 ? 'It may also be:' : 'Possible causes:'}
                  problems={possible}
                  className={s.problems}
                />
              </>
            ) : (
              <>
                {error}. Grafana does not pass on CloudWatch&apos;s error message, and no problem was found in the
                query. The exact message is in the Grafana server log.
              </>
            )}
          </Alert>
        )}

        {result && !result.error && (
          <section className={cx(s.results, autoExpand ? s.resultsAuto : s.resultsFill)}>
            <div className={s.meta}>
              <div className={s.stats}>
                <span className={s.range}>
                  {formatTime(result.from, ws.state.timeZone)} → {formatTime(result.to, ws.state.timeZone)}{' '}
                  {zoneLabel(result.from, ws.state.timeZone)}
                </span>
                {statsParts(result)
                  .slice(0, 2)
                  .map((part) => (
                    <span key={part} className={s.stat}>
                      {part}
                    </span>
                  ))}
                {result.stats?.bytesScanned !== undefined && (
                  <CostBadge bytes={result.stats.bytesScanned} costPerGb={costPerGb} className={s.stat} />
                )}
                {statsParts(result)
                  .slice(2)
                  .map((part) => (
                    <span key={part} className={s.stat}>
                      {part}
                    </span>
                  ))}
              </div>
              <span className={s.layout}>
                {!autoExpand && (
                  <Button
                    size="sm"
                    variant="secondary"
                    fill="text"
                    icon={focusResults ? 'angle-double-down' : 'angle-double-up'}
                    title={focusResults ? 'Show query' : 'Expand results'}
                    onClick={() => setFocusResults(!focusResults)}
                  >
                    {focusResults ? 'Show query' : 'Expand results'}
                  </Button>
                )}
                <RadioButtonGroup
                  size="sm"
                  value={autoExpand ? 'scroll' : 'pinned'}
                  options={LAYOUT_OPTIONS}
                  onChange={(layout) => ws.setAutoExpand(layout === 'scroll')}
                />
              </span>
            </div>
            <ResultsTable
              key={`${tab.id}:${result.ranAt}`}
              result={result}
              timeZone={ws.state.timeZone}
              columns={tab.columns ?? {}}
              onColumnsChange={(columns) => ws.updateTab(tab.id, { columns })}
              onRunRange={zoomTo}
              onAddQueryFilter={addQueryFilter}
              exportName={tab.title}
              onFilterClauses={setTableClauses}
              initialView={tableViews.get(tab.id, result.ranAt)}
              onSaveView={(view) => tableViews.save(tab.id, result.ranAt, view)}
            />
          </section>
        )}
      </div>
    </PluginPage>
  );
}

export default App;

function ProblemList({ title, problems, className }: { title: string; problems: QueryProblem[]; className: string }) {
  if (problems.length === 0) {
    return null;
  }
  return (
    <>
      <div>{title}</div>
      <ul className={className}>
        {problems.map((p) => (
          <li key={formatProblem(p)}>{formatProblem(p)}</li>
        ))}
      </ul>
    </>
  );
}

/** "2.3s", "Scanned 1.2 GB", "48,312 records", "50 matched": what the query scanned and found. */
function statsParts(result: QueryResult): string[] {
  const { bytesScanned, recordsScanned, recordsMatched } = result.stats ?? {};
  // Duration and bytes come first: the cost badge goes right after them.
  return [
    `${(result.durationMs / 1000).toFixed(1)}s`,
    bytesScanned !== undefined ? `Scanned ${formatBytes(bytesScanned)}` : '',
    recordsScanned !== undefined ? `${Math.round(recordsScanned).toLocaleString('en-US')} records` : '',
    recordsMatched !== undefined ? `${Math.round(recordsMatched).toLocaleString('en-US')} matched` : '',
  ].filter(Boolean);
}

/** The cost estimate, with a tooltip saying how it is worked out and where the price is set. */
function CostBadge({ bytes, costPerGb, className }: { bytes: number; costPerGb: number; className: string }) {
  const s = useStyles2(getStyles);
  const gb = bytes / 2 ** 30;
  const content = (
    <div className={s.costTip}>
      <div>
        {gb < 0.01 ? gb.toPrecision(2) : gb.toFixed(2)} GB scanned × ${costPerGb} per GB ={' '}
        {exactCost(estimateCost(bytes, costPerGb))}
      </div>
      <div>
        Logs Insights charges only for data scanned. AWS does not report the cost of a query, so this is an estimate
        from the list price, not your bill.
      </div>
      <div>
        The price per GB is set by an admin in{' '}
        <a className={s.costLink} href={`${config.appSubUrl}/plugins/${PLUGIN_ID}`}>
          Administration → Plugins → CloudWatch Logs
        </a>
        .
      </div>
    </div>
  );
  return (
    <Tooltip content={content} interactive placement="bottom">
      <span className={cx(className, s.cost)}>{formatCost(estimateCost(bytes, costPerGb))}</span>
    </Tooltip>
  );
}

/** Full precision for the tooltip, where "< $0.0001" would hide the actual figure. */
function exactCost(usd: number): string {
  return `$${usd === 0 ? 0 : usd < 0.01 ? usd.toPrecision(2) : usd.toFixed(4)}`;
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

/** "≈ 40 MB · $0.00020": what the query would scan, and what that costs. */
function scanText(bytes: number, costPerGb: number): string {
  // One ≈ for both: "≈ 40 MB · $0.00020", or "≈ 2 KB · < $0.0001".
  return `≈ ${formatBytes(bytes)} · ${formatCost(estimateCost(bytes, costPerGb)).replace(/^≈ /, '')}`;
}

/** The Run button's tooltip: the shortcut, and what CloudWatch estimates the query scans. */
interface RunTooltipProps {
  bytes?: number;
  error?: string;
  /** A new estimate is due or on its way: the figure on the button is for the previous inputs. */
  updating: boolean;
  costPerGb: number;
}

function RunTooltip({ bytes, error, updating, costPerGb }: RunTooltipProps) {
  return (
    <>
      <div>Ctrl/Cmd + Enter</div>
      {updating && <div>Updating the scan estimate for the changes…</div>}
      {bytes !== undefined && (
        <div>
          CloudWatch estimates this query scans {formatBytes(bytes)}, {formatCost(estimateCost(bytes, costPerGb))} at $
          {costPerGb} per GB. The estimate itself is free.
        </div>
      )}
      {/* Grafana 10.4 hides CloudWatch's reason behind a generic message: no use repeating it. */}
      {error && <div>Could not estimate the scan{error === GENERIC_PLUGIN_ERROR ? '.' : `: ${error}`}</div>}
    </>
  );
}

function isCancelled(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && 'cancelled' in e && (e as { cancelled?: boolean }).cancelled);
}

/** Whether the element can scroll vertically any further in the direction of deltaY. */
function canScrollY(el: HTMLElement, deltaY: number): boolean {
  if (el.scrollHeight <= el.clientHeight || !/auto|scroll/.test(getComputedStyle(el).overflowY)) {
    return false;
  }
  return deltaY < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
}

/**
 * The query part, then the table's rows, read as one long page: scrolling down moves the query part
 * out of view first and then the rows, whatever the pointer is over. Scrolling up over the rows
 * brings them back to the top first and then the query part; anywhere else it brings the query part
 * back straight away and leaves the rows where they are. Anything else under the pointer that
 * scrolls itself (the editor, a long cell) keeps the wheel while it can.
 */
function scrollAsOne(e: WheelEvent, page: HTMLElement) {
  if (e.defaultPrevented || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    return;
  }
  const table = page.querySelector<HTMLElement>(`[${RESULTS_SCROLL}]`);
  for (let node = e.target as HTMLElement | null; node && node !== page && node !== table; node = node.parentElement) {
    if (canScrollY(node, e.deltaY)) {
      return;
    }
  }
  const unit =
    e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? page.clientHeight : 1;
  let delta = e.deltaY * unit;
  const overRows = table?.contains(e.target as Node) ?? false;
  const order = delta > 0 ? [page, table] : overRows ? [table, page] : [page];
  for (const el of order) {
    if (!el || Math.abs(delta) < 0.5) {
      continue;
    }
    const before = el.scrollTop;
    el.scrollTop = before + delta;
    delta -= el.scrollTop - before;
  }
  e.preventDefault();
}

/** Whether the query stays put above the results or scrolls away with the logs (autoExpand). */
const LAYOUT_OPTIONS: Array<{ label: string; value: 'pinned' | 'scroll'; description: string; icon: IconName }> = [
  {
    label: 'Query pinned',
    value: 'pinned',
    icon: 'gf-pin',
    description: 'The query stays on top and the table takes the space under it; Expand results hides the query',
  },
  {
    label: 'Query scrolls away',
    value: 'scroll',
    icon: 'arrows-v',
    description: 'Scrolling the logs moves the query out of view, so the table gets the whole page',
  },
];

const { alpha } = colorManipulator;

const wave = keyframes({ from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(100%)' } });

/** The results keep at least this much on a very short page; less, and the page scrolls. */
const RESULTS_MIN_HEIGHT = 320;
const RESULTS_FILL_MIN_HEIGHT = 240;

const getStyles = (theme: GrafanaTheme2) => ({
  // Fills Grafana's page area and scrolls itself, so Grafana's own scroll container stays put. It only
  // scrolls with auto-expand, or when the page is too short for the results' minimum height.
  page: css({
    flex: '1 1 0',
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    padding: theme.spacing(2),
    '& > *': { flexShrink: 0 },
  }),
  // With auto-expand the page scrolls as one with the table (see scrollAsOne), without a scrollbar of
  // its own: the table's is the only one.
  pageAuto: css({ scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }),
  topBar: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
    paddingBottom: theme.spacing(1),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  editorRow: css({
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 360px',
    gap: theme.spacing(2),
    [theme.breakpoints.down('lg')]: { gridTemplateColumns: 'minmax(0, 1fr)' },
  }),
  timeColumn: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(2) }),
  // Same size whatever the picker above shows (Relative grid or Absolute fields).
  // Pinned to the bottom of the column so it does not move when the picker above changes height.
  // The label fills the button: the action on the left, the estimate on the right.
  runButton: css({
    flex: '0 0 auto',
    height: theme.spacing(6),
    marginTop: 'auto',
    justifyContent: 'flex-start',
    '& > span:last-child': { flex: 1, minWidth: 0 },
  }),
  // Grafana's button content is a flex row of its own: the label has to grow to fill it.
  runLabel: css({
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
  }),
  // A price tag on the button: what the query would scan and cost. Quiet, so the action stays first.
  runEstimate: css({
    display: 'inline-flex',
    alignItems: 'center',
    minWidth: 0,
    padding: theme.spacing(0.25, 1),
    borderRadius: theme.shape.radius.pill,
    background: alpha(theme.colors.primary.contrastText, 0.12),
    opacity: 0.75,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightRegular,
    lineHeight: theme.typography.bodySmall.lineHeight,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    position: 'relative',
    overflow: 'hidden',
  }),
  // The figure is for earlier inputs: kept, but faded, until the new one comes.
  runEstimateStale: css({ opacity: 0.55 }),
  // Before the first figure: the chip's usual width, with nothing to read.
  runEstimatePlaceholder: css({ color: 'transparent' }),
  // A light band sweeping across the chip: the figure is being worked out, the button itself is fine.
  runEstimateWave: css({
    '&::after': {
      content: '""',
      position: 'absolute',
      inset: 0,
      background: `linear-gradient(90deg, transparent, ${alpha(theme.colors.primary.contrastText, 0.3)}, transparent)`,
      animation: `${wave} 1.2s ease-in-out infinite`,
    },
    '@media (prefers-reduced-motion: reduce)': { '&::after': { display: 'none' } },
  }),
  hint: css({ color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize, textAlign: 'center' }),
  problems: css({ margin: theme.spacing(0.5, 0, 0, 2), fontFamily: theme.typography.fontFamilyMonospace }),
  results: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(1) }),
  // As tall as the page: scrolled down, the results fill it and the query part is above, out of view.
  resultsAuto: css({ height: '100%', minHeight: RESULTS_MIN_HEIGHT }),
  // What the query part leaves.
  resultsFill: css({ flex: '1 0 0', minHeight: RESULTS_FILL_MIN_HEIGHT }),
  // One row whatever the width: the buttons keep their place on the right, and stats that do not fit
  // next to them are left out, whole and from the end.
  meta: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  // A wrapping row one line high: a pill that does not fit moves to the second line, which is cut off.
  stats: css({
    flex: '1 1 auto',
    minWidth: 0,
    height: 20,
    lineHeight: '20px',
    overflow: 'hidden',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: theme.spacing(1),
  }),
  // Alone on the line, the range shortens with an ellipsis instead.
  range: css({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
  stat: css({
    flexShrink: 0,
    whiteSpace: 'nowrap',
    padding: theme.spacing(0, 1),
    borderRadius: theme.shape.radius.pill,
    background: theme.colors.background.secondary,
    fontVariantNumeric: 'tabular-nums',
  }),
  layout: css({
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    // Narrow pages: icons only, their names in the tooltips. The switch's labels are bare text.
    [theme.breakpoints.down('lg')]: {
      '& button > span': { display: 'none' },
      '& label': { fontSize: 0 },
      '& label svg': { marginRight: 0 },
    },
  }),
  cost: css({ cursor: 'help' }),
  costTip: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(0.75), maxWidth: 320 }),
  costLink: css({ color: theme.colors.text.link, textDecoration: 'underline' }),
});
