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
  Results live only in the tab's memory.

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
  components/Results/          results table with a filter and expandable rows
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
