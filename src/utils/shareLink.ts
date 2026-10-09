import { LogGroupRef, QueryTab, TimeRangeValue, TimeUnit } from '../types';
import { DEFAULT_TIME_RANGE } from './timeRange';

/** What a shared link carries: enough to rebuild the tab, but not its results or layout. */
export interface SharedQuery {
  query: string;
  logGroups: LogGroupRef[];
  timeRange: TimeRangeValue;
  datasourceUid?: string;
}

const UNIT_SUFFIX: Record<TimeUnit, string> = { minutes: 'm', hours: 'h', days: 'd' };
const SUFFIX_UNIT: Record<string, TimeUnit> = { m: 'minutes', h: 'hours', d: 'days' };

/** Search params for a link, in Grafana's own from/to style: now-30m..now or epoch millis. */
export function toShareParams(shared: SharedQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set('query', shared.query);
  // Log group names cannot contain ":", so the first one separates the region.
  shared.logGroups.forEach((g) => params.append('group', `${g.region}:${g.name}`));
  if (shared.timeRange.mode === 'relative') {
    params.set('from', `now-${shared.timeRange.amount}${UNIT_SUFFIX[shared.timeRange.unit]}`);
    params.set('to', 'now');
  } else {
    params.set('from', String(shared.timeRange.from));
    params.set('to', String(shared.timeRange.to));
  }
  if (shared.datasourceUid) {
    params.set('ds', shared.datasourceUid);
  }
  return params;
}

/** Reads a shared link; undefined when the URL is not one. */
export function fromShareParams(params: URLSearchParams): SharedQuery | undefined {
  const query = params.get('query');
  if (query === null) {
    return undefined;
  }
  const logGroups = params.getAll('group').flatMap((value) => {
    const i = value.indexOf(':');
    return i > 0 ? [{ region: value.slice(0, i), name: value.slice(i + 1) }] : [];
  });
  return {
    query,
    logGroups,
    timeRange: parseRange(params.get('from'), params.get('to')),
    datasourceUid: params.get('ds') ?? undefined,
  };
}

function parseRange(from: string | null, to: string | null): TimeRangeValue {
  const relative = from ? /^now-(\d+)([mhd])$/.exec(from) : null;
  if (relative && (to === null || to === 'now')) {
    return { mode: 'relative', amount: Number(relative[1]), unit: SUFFIX_UNIT[relative[2]] };
  }
  const start = Number(from);
  const end = Number(to);
  if (from && to && Number.isFinite(start) && Number.isFinite(end) && start < end) {
    return { mode: 'absolute', from: start, to: end };
  }
  return DEFAULT_TIME_RANGE;
}

/** Same query, groups and time range: opening the link again selects the tab instead of adding one. */
export function matchesTab(tab: QueryTab, shared: SharedQuery): boolean {
  return (
    tab.query === shared.query &&
    JSON.stringify(tab.timeRange) === JSON.stringify(shared.timeRange) &&
    tab.logGroups.length === shared.logGroups.length &&
    tab.logGroups.every((g, i) => g.name === shared.logGroups[i].name && g.region === shared.logGroups[i].region)
  );
}

export const SHARE_PARAM_KEYS = ['query', 'group', 'from', 'to', 'ds'];
