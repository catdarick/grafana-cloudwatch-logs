import React, { useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { AppRootProps, GrafanaTheme2, PageLayoutType } from '@grafana/data';
import { DataSourcePicker, PluginPage, getDataSourceSrv } from '@grafana/runtime';
import { Alert, Button, useStyles2 } from '@grafana/ui';
import { cancelQuery, fetchLogGroupFields, runLogsQuery } from '../../api/cloudwatch';
import { useWorkspace } from '../../state/useWorkspace';
import { AppSettings, QueryResult } from '../../types';
import { describeTimeRange, formatTime, isValidRange, toEpochRange } from '../../utils/timeRange';
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
  const [discoveredFields, setDiscoveredFields] = useState<Record<string, string[]>>({});

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

  const run = async () => {
    if (!datasourceUid || !canRun) {
      return;
    }
    const tabId = tab.id;
    const { from, to } = toEpochRange(tab.timeRange);
    setRunning((r) => ({ ...r, [tabId]: true }));
    setRunError((e) => ({ ...e, [tabId]: undefined }));
    try {
      const result = await runLogsQuery({
        datasourceUid,
        requestId: requestId(tabId),
        query: tab.query,
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
  const error = runError[tab.id] ?? result?.error;

  return (
    <PluginPage layout={PageLayoutType.Canvas}>
      <div className={s.page} data-testid={testIds.app.container}>
        <div className={s.topBar}>
          <QueryTabs
            tabs={ws.state.tabs}
            activeTabId={tab.id}
            results={results}
            running={running}
            onSelect={ws.selectTab}
            onClose={(id) => {
              cancelQuery(requestId(id));
              ws.closeTab(id);
            }}
            onAdd={() => ws.addTab(tab)}
            onRename={(id, title) => ws.updateTab(id, { title })}
          />
          <DataSourcePicker
            pluginId="cloudwatch"
            current={datasourceUid ?? null}
            width={28}
            onChange={(ds) => setDatasourceUid(ds.uid)}
          />
        </div>

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
            onRun={run}
            onSave={ws.saveQuery}
            onDelete={ws.deleteQuery}
          />
          <section className={s.timeColumn}>
            <h5 className={s.title}>Time range</h5>
            <TimeRangePicker value={tab.timeRange} onChange={(timeRange) => ws.updateTab(tab.id, { timeRange })} />
            {running[tab.id] ? (
              <Button
                size="lg"
                variant="destructive"
                icon="square-shape"
                fullWidth
                onClick={() => cancelQuery(requestId(tab.id))}
              >
                Stop
              </Button>
            ) : (
              <Button size="lg" icon="play" fullWidth disabled={!canRun} onClick={run} tooltip="Ctrl/Cmd + Enter">
                Run query
              </Button>
            )}
            {tab.logGroups.length === 0 && <span className={s.hint}>Select at least one log group</span>}
          </section>
        </div>

        {error && (
          <Alert severity="error" title="Query failed">
            {error}
          </Alert>
        )}

        {result && !result.error && (
          <section className={s.results}>
            <div className={s.meta}>
              {describeTimeRange(tab.timeRange)} · {formatTime(result.from)} → {formatTime(result.to)} ·{' '}
              {(result.durationMs / 1000).toFixed(1)}s
            </div>
            <ResultsTable key={result.ranAt} result={result} />
          </section>
        )}
      </div>
    </PluginPage>
  );
}

export default App;

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
  title: css({ margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }),
  hint: css({ color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize, textAlign: 'center' }),
  results: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(1) }),
  meta: css({ color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize }),
});
