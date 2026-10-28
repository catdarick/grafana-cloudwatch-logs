# CloudWatch Logs (Grafana app plugin)

A Grafana page for CloudWatch Logs Insights: tabs (each with its own log groups, query, time range and results),
favorite log groups, saved queries and a Relative/Absolute time picker with quick buttons.

Requires **Grafana 10.4** or later.

## How it works

- Queries go through the CloudWatch data source already configured in Grafana; the plugin has no backend or AWS keys of its own.
- `POST /api/ds/query` with `queryMode: "Logs"` and no `type`: Grafana's CloudWatch backend runs `StartQuery`
  and polls `GetQueryResults` until the query finishes (the same path alerting uses). The timeout comes from the
  datasource "Logs timeout".
- Log groups for search: `GET /api/datasources/uid/<uid>/resources/log-groups`.
- Groups from different regions go out as separate queries and their rows are merged.
- Tabs, favorites and saved queries are kept in the browser's `localStorage` (10.4 has no user storage API).
  Results live only in the tab's memory. Column settings (order, hidden, widths) are kept in the tab.
- "Copy link" in the editor copies a link like `/a/gauss-cloudwatchlogs-app?query=…&group=<region>:<group>&from=now-30m&to=now&ds=<uid>`
  (a relative range can be pinned to the last run). Opening it puts the query in a new tab
  (or selects an identical one) and removes the params from the address. The query is not run automatically.
- Grafana sorts log rows by time ascending and loses the query's `sort`; the plugin re-applies
  the query's last `sort` to the returned rows (including rows merged from several regions).
- The histogram above the table is built from the loaded rows (free); selecting or clicking bars narrows
  the loaded rows without a new query. "Run for this range" runs the query for that range.
- Fields of the raw JSON log (`@message`, nested ones as `kubernetes.pod_name`) can be added as columns via Columns →
  "Add from raw log", without a new query. In the expanded log, 🔍+/🔍− filter the table (the field becomes a column),
  and "⋯" adds a `filter` to the query and re-runs it.
- Active table filters (column value filters and search with "Hide non-matching") appear in the editor as faint
  `| filter …` lines in Logs Insights syntax. Clicking one inserts the filter into the query (before sort/limit) without running it.
  They are Monaco view zones, not part of the query text.
- "Export CSV" above the table opens one dialog: which rows (shown or all loaded; only asked when filters,
  search or zoom hide some), which columns (the visible ones by default) and which parts of the raw log (`@message`,
  `@log`, `@logStream`). Times in the selected zone, UTF-8 with a BOM.
- Next to "Scanned …" is an estimate of the query's cost: GB scanned × price per GB (default $0.005,
  set in the plugin settings). AWS does not report the cost, so this is an estimate from the list price.
- Every query is prefixed with `fields @message as __message__grafana_internal__` so that expanding a row shows
  the whole log (the JSON in `@message`), not just the query's fields. A query that returns `@message` itself
  (`fields @timestamp, @message | …`) is sent as it is and its own `@message` is used, so the message does not come
  to the browser twice. `stats` queries and queries with `display` lack it, and the row's fields are shown instead.

## Layout

```
src/
  api/cloudwatch.ts            data source queries, frame parsing
  state/useWorkspace.ts        tabs, favorites, saved queries (+ localStorage)
  components/App/App.tsx       the whole page
  components/TimeRangePicker/  the ported time range picker + time zone
  utils/parseTime.ts           parsing pasted times (ISO, epoch, DD.MM.YYYY, now-1h, ranges)
  components/LogGroups/        favorite and searchable log groups
  components/QueryEditor/      editor (Monaco) + saved queries
  language/logsInsights.ts     Logs Insights syntax highlighting
  components/Tabs/             tabs
  components/Results/          results table (virtualized), histogram, JSON tree, columns, filters, search
  utils/table.ts               column order, value counts, search, full log parsing
  components/AppConfig/        settings page (default data source and region)
```

## Development

```bash
cp .env.example .env   # Grafana 10.4.19 for docker compose
npm install
npm run dev            # watch build into dist/
AWS_PROFILE=my-profile AWS_REGION=us-east-2 npm run server   # Grafana at http://localhost:3000
```

AWS access comes from `~/.aws`: the folder is mounted into the container read-only, and the data source uses
the default AWS SDK chain with the profile from `AWS_PROFILE` (`default` if unset). Static keys,
`role_arn` + `source_profile` and SSO (run `aws sso login --profile my-profile` first) work. Profiles with `credential_process`
will not work if the process is built for macOS: it runs inside a Linux container. Explicit
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` also work and take precedence over the profile.

Checks: `npm run typecheck && npm run lint && npm run test:ci && npm run build`.

## Installing

1. Build and sign: `npm run build && npm run sign -- --rootUrls https://<grafana address>/`
   (private signature; needs a `GRAFANA_ACCESS_POLICY_TOKEN` from a free Grafana Cloud account).
2. Zip `dist/` with a `gauss-cloudwatchlogs-app/` folder inside and install it like any other plugin: unpack it into
   Grafana's plugins directory, or point `GF_INSTALL_PLUGINS` at the zip:
   `GF_INSTALL_PLUGINS=https://<host>/gauss-cloudwatchlogs-app-<version>.zip;gauss-cloudwatchlogs-app`
3. Restart Grafana, enable the app and pick the CloudWatch data source on its configuration page.

## Known limitations

- On this path Grafana 10.4 reports a query error (a syntax error, for example) as the generic
  "An error occurred within the plugin". If exact error messages and progress are needed,
  the next step is to call `StartQuery` / `GetQueryResults` from the plugin itself.
- Stop aborts the HTTP request and Grafana's polling, but a query already started in AWS runs to completion.
