import React, { useEffect, useMemo, useState } from 'react';
import { css, cx } from '@emotion/css';
import { AppRootProps, GrafanaTheme2, PageLayoutType } from '@grafana/data';
import { DataSourcePicker, PluginPage, config, getDataSourceSrv, locationService } from '@grafana/runtime';
import { Alert, Button, TimeZonePicker, Tooltip, useStyles2 } from '@grafana/ui';
import { cancelQuery, fetchLogGroupFields, runLogsQuery } from '../../api/cloudwatch';
import { useWorkspace } from '../../state/useWorkspace';
import { PLUGIN_BASE_URL, PLUGIN_ID } from '../../constants';
import { AppSettings, QueryResult, TimeRangeValue } from '../../types';
import { copyWithToast } from '../../utils/clipboard';
import { DEFAULT_COST_PER_GB, estimateCost, formatCost } from '../../utils/cost';
import { addQueryStage } from '../../utils/table';
import { SHARE_PARAM_KEYS, fromShareParams, toShareParams } from '../../utils/shareLink';
import { formatTime, isValidRange, toEpochRange, zoneLabel } from '../../utils/timeRange';
import { LogGroups } from '../LogGroups/LogGroups';
import { QueryEditor } from '../QueryEditor/QueryEditor';
import { ResultsTable } from '../Results/ResultsTable';
import { QueryTabs } from '../Tabs/QueryTabs';
import { TimeRangePicker } from '../TimeRangePicker/TimeRangePicker';
import { testIds } from '../testIds';

function defaultDatasourceUid(settings: AppSettings): string | undefined {
  return settings.datasourceUid ?? getDataSourceSrv().getList({ type: 'cloudwatch' })[0]?.uid;
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
  // Hides log groups and the editor so the results get the whole page.
  const [focusResults, setFocusResults] = useState(false);
  const [discoveredFields, setDiscoveredFields] = useState<Record<string, string[]>>({});

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

  // Autocomplete: fields CloudWatch has seen in the selected groups, plus fields from earlier results.
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
    Object.values(results).forEach((r) => r?.fields.forEach((f) => names.add(f)));
    return Array.from(names).sort();
  }, [tab.logGroups, discoveredFields, results]);

  const dsRegion = datasourceUid
    ? (getDataSourceSrv().getInstanceSettings(datasourceUid)?.jsonData as { defaultRegion?: string } | undefined)
        ?.defaultRegion
    : undefined;
  const defaultRegion = settings.defaultRegion || dsRegion || 'us-east-1';

  const requestId = (id: string) => `cloudwatch-logs-app-${id}`;
  const canRun =
    Boolean(datasourceUid) && tab.logGroups.length > 0 && tab.query.trim() !== '' && isValidRange(tab.timeRange);

  /** Runs the active tab; overrides cover changes made in the same click, before state has updated. */
  const run = async (override: { query?: string; timeRange?: TimeRangeValue } = {}) => {
    if (!datasourceUid || !canRun) {
      return;
    }
    const tabId = tab.id;
    const query = override.query ?? tab.query;
    const { from, to } = toEpochRange(override.timeRange ?? tab.timeRange);
    setRunning((r) => ({ ...r, [tabId]: true }));
    setRunError((e) => ({ ...e, [tabId]: undefined }));
    try {
      const result = await runLogsQuery({
        datasourceUid,
        requestId: requestId(tabId),
        query,
        logGroups: tab.logGroups,
        from,
        to,
      });
      setResults((r) => ({ ...r, [tabId]: result }));
    } catch (e) {
      if (!isCancelled(e)) {
        setRunError((errs) => ({ ...errs, [tabId]: errorMessage(e) }));
      }
    } finally {
      setRunning((r) => ({ ...r, [tabId]: false }));
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

  return (
    <PluginPage layout={PageLayoutType.Canvas}>
      <div className={s.page} data-testid={testIds.app.container}>
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

        {!focusResults && (
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
                relativeTime={tab.timeRange.mode === 'relative'}
                onCopyLink={copyLink}
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
                    tooltip="Ctrl/Cmd + Enter"
                  >
                    Run query
                  </Button>
                )}
                {tab.logGroups.length === 0 && <span className={s.hint}>Select at least one log group</span>}
              </section>
            </div>
          </>
        )}

        {error && (
          <Alert severity="error" title="Query failed">
            {error}
          </Alert>
        )}

        {result && !result.error && (
          <section className={s.results}>
            <div className={s.meta}>
              <span>
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
                <CostBadge
                  bytes={result.stats.bytesScanned}
                  costPerGb={settings.costPerGb ?? DEFAULT_COST_PER_GB}
                  className={s.stat}
                />
              )}
              {statsParts(result)
                .slice(2)
                .map((part) => (
                  <span key={part} className={s.stat}>
                    {part}
                  </span>
                ))}
              <Button
                className={s.focusToggle}
                size="sm"
                variant="secondary"
                fill="text"
                icon={focusResults ? 'angle-double-down' : 'angle-double-up'}
                onClick={() => setFocusResults(!focusResults)}
              >
                {focusResults ? 'Show query' : 'Expand results'}
              </Button>
            </div>
            <ResultsTable
              key={result.ranAt}
              result={result}
              timeZone={ws.state.timeZone}
              columns={tab.columns ?? {}}
              onColumnsChange={(columns) => ws.updateTab(tab.id, { columns })}
              onRunRange={zoomTo}
              onAddQueryFilter={addQueryFilter}
              exportName={tab.title}
            />
          </section>
        )}
      </div>
    </PluginPage>
  );
}

export default App;

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

function isCancelled(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && 'cancelled' in e && (e as { cancelled?: boolean }).cancelled);
}

function errorMessage(e: unknown): string {
  if (e && typeof e === 'object') {
    const data = (e as { data?: { message?: string; results?: Record<string, { error?: string }> } }).data;
    const resultError = data?.results && Object.values(data.results).find((r) => r.error)?.error;
    if (resultError) {
      return resultError;
    }
    if (data?.message) {
      return data.message;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

const getStyles = (theme: GrafanaTheme2) => ({
  page: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(2), padding: theme.spacing(2) }),
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
  runButton: css({ flex: '0 0 auto', height: theme.spacing(6), marginTop: 'auto' }),
  hint: css({ color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize, textAlign: 'center' }),
  results: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(1) }),
  meta: css({
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  stat: css({
    padding: theme.spacing(0, 1),
    borderRadius: theme.shape.radius.pill,
    background: theme.colors.background.secondary,
    fontVariantNumeric: 'tabular-nums',
  }),
  focusToggle: css({ marginLeft: 'auto' }),
  cost: css({ cursor: 'help' }),
  costTip: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(0.75), maxWidth: 320 }),
  costLink: css({ color: theme.colors.text.link, textDecoration: 'underline' }),
});
