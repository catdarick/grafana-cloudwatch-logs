export type TimeUnit = 'minutes' | 'hours' | 'days';

export type TimeRangeValue =
  { mode: 'relative'; amount: number; unit: TimeUnit } | { mode: 'absolute'; from: number; to: number };

export interface LogGroupRef {
  name: string;
  region: string;
  arn?: string;
}

export interface QueryResult {
  ranAt: number;
  durationMs: number;
  from: number;
  to: number;
  fields: string[];
  /** Fields holding epoch millis; formatted in the selected time zone when shown. */
  timeFields: string[];
  rows: Array<Record<string, string>>;
  /** Per row: the whole log event, which the query's own fields may not include. */
  details: LogDetails[];
  error?: string;
}

export interface LogDetails {
  /** Raw @message; absent for stats queries or queries ending in display. */
  message?: string;
  logGroup?: string;
  logStream?: string;
}

/** Table layout per tab, keyed by field name so it survives re-running the query. */
export interface ColumnSettings {
  order?: string[];
  hidden?: string[];
  widths?: Record<string, number>;
}

export interface QueryTab {
  id: string;
  title: string;
  query: string;
  logGroups: LogGroupRef[];
  timeRange: TimeRangeValue;
  savedQueryName?: string;
  columns?: ColumnSettings;
}

export interface SavedQuery {
  name: string;
  query: string;
}

/** Everything that survives a page reload. Results are kept in memory only. */
export interface PersistedState {
  tabs: QueryTab[];
  activeTabId: string;
  favorites: LogGroupRef[];
  savedQueries: SavedQuery[];
  /** Grafana time zone id: "utc", "browser" or an IANA name. */
  timeZone: string;
}

export interface AppSettings {
  datasourceUid?: string;
  defaultRegion?: string;
}
