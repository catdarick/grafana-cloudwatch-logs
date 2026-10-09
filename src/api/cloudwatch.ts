import { Subscription } from 'rxjs';
import { DataFrame, FieldType } from '@grafana/data';
import {
  BackendDataSourceResponse,
  BackendSrvRequest,
  FetchResponse,
  getBackendSrv,
  toDataQueryResponse,
} from '@grafana/runtime';
import { LogGroupRef, QueryResult } from '../types';

// Fields Grafana adds to every Logs Insights query (see pkg/tsdb/cloudwatch/log_actions.go).
const INTERNAL_FIELD_SUFFIX = '__grafana_internal__';

interface LogGroupsResponseItem {
  value: { arn: string; name: string };
  accountId?: string;
}

/** Lists log groups through the CloudWatch datasource's resource API. */
export async function fetchLogGroups(datasourceUid: string, region: string, prefix: string): Promise<LogGroupRef[]> {
  const params: Record<string, string> = { region, limit: '50' };
  if (prefix.trim()) {
    params.logGroupNamePrefix = prefix.trim();
  }
  const items = await getBackendSrv().get<LogGroupsResponseItem[]>(
    `/api/datasources/uid/${datasourceUid}/resources/log-groups`,
    params
  );
  return (items ?? []).map((item) => ({ name: item.value.name, arn: item.value.arn, region }));
}

export interface RunQueryArgs {
  datasourceUid: string;
  requestId: string;
  query: string;
  logGroups: LogGroupRef[];
  from: number;
  to: number;
}

/**
 * Runs a Logs Insights query through /api/ds/query.
 *
 * The query has queryMode "Logs" and no "type", so the CloudWatch backend runs StartQuery and polls
 * GetQueryResults itself (the same path alerting and public dashboards use) and returns the final rows.
 * Log groups from different regions are sent as separate queries and merged.
 */
export async function runLogsQuery(args: RunQueryArgs): Promise<QueryResult> {
  const startedAt = Date.now();
  const byRegion = groupByRegion(args.logGroups);

  const queries = Array.from(byRegion.entries()).map(([region, groups], i) => ({
    refId: `R${i}`,
    datasource: { type: 'cloudwatch', uid: args.datasourceUid },
    queryMode: 'Logs',
    region,
    id: '',
    expression: args.query,
    logGroupNames: groups.map((g) => g.name),
    // Only used when cross-account querying is enabled; requires every group to have an ARN.
    ...(groups.every((g) => g.arn) ? { logGroups: groups.map((g) => ({ arn: g.arn, name: g.name })) } : {}),
  }));

  const response = await fetchCancellable<BackendDataSourceResponse>(args.requestId, {
    url: '/api/ds/query',
    method: 'POST',
    showErrorAlert: false,
    data: { from: String(args.from), to: String(args.to), queries },
  });

  const parsed = toDataQueryResponse(response);
  const result = framesToRows(parsed.data as DataFrame[], args.query);
  return {
    ...result,
    ranAt: startedAt,
    durationMs: Date.now() - startedAt,
    from: args.from,
    to: args.to,
    error:
      parsed.errors
        ?.map((e) => e.message)
        .filter(Boolean)
        .join('; ') || undefined,
  };
}

const inFlight = new Map<string, { subscription: Subscription; reject: (reason: unknown) => void }>();

/** Aborts the HTTP request; the backend then stops polling CloudWatch for this query. */
export function cancelQuery(requestId: string) {
  const entry = inFlight.get(requestId);
  if (entry) {
    inFlight.delete(requestId);
    entry.subscription.unsubscribe();
    entry.reject({ cancelled: true });
  }
}

function fetchCancellable<T>(requestId: string, options: BackendSrvRequest): Promise<FetchResponse<T>> {
  cancelQuery(requestId);
  return new Promise((resolve, reject) => {
    const subscription = getBackendSrv()
      .fetch<T>(options)
      .subscribe({
        next: (response) => {
          inFlight.delete(requestId);
          resolve(response);
        },
        error: (err) => {
          inFlight.delete(requestId);
          reject(err);
        },
      });
    if (!subscription.closed) {
      inFlight.set(requestId, { subscription, reject });
    }
  });
}

function groupByRegion(groups: LogGroupRef[]): Map<string, LogGroupRef[]> {
  const map = new Map<string, LogGroupRef[]>();
  for (const g of groups) {
    const region = g.region || 'default';
    map.set(region, [...(map.get(region) ?? []), g]);
  }
  return map;
}

export function framesToRows(frames: DataFrame[], query: string): Pick<QueryResult, 'fields' | 'timeFields' | 'rows'> {
  // Grafana prepends "fields @timestamp" to every query; hide it unless the user asked for it.
  const showTimestamp = query.includes('@timestamp');
  const fields: string[] = [];
  const timeFields = new Set<string>();
  const rows: Array<Record<string, string>> = [];

  for (const frame of frames) {
    const visible = frame.fields.filter(
      (f) => !f.name.endsWith(INTERNAL_FIELD_SUFFIX) && (showTimestamp || f.name !== '@timestamp')
    );
    for (const f of visible) {
      if (!fields.includes(f.name)) {
        fields.push(f.name);
      }
      if (f.type === FieldType.time) {
        timeFields.add(f.name);
      }
    }
    for (let i = 0; i < frame.length; i++) {
      const row: Record<string, string> = {};
      for (const f of visible) {
        const value = f.values[i];
        if (value === null || value === undefined || value === '') {
          continue;
        }
        row[f.name] = String(value);
      }
      rows.push(row);
    }
  }
  return { fields, timeFields: Array.from(timeFields), rows };
}

interface LogGroupFieldsResponseItem {
  value: { name: string; percent: number };
}

/** Field names CloudWatch discovered in a log group over the last 15 minutes. */
export async function fetchLogGroupFields(datasourceUid: string, group: LogGroupRef): Promise<string[]> {
  const items = await getBackendSrv().get<LogGroupFieldsResponseItem[]>(
    `/api/datasources/uid/${datasourceUid}/resources/log-group-fields`,
    { logGroupName: group.name, region: group.region }
  );
  return (items ?? []).map((item) => item.value.name);
}
