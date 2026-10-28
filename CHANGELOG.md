# Changelog

## 1.0.4

- A query that returns `@message` itself (`fields @timestamp, @message | …`) no longer gets a second copy of it for the expanded row, so its results are about half the size.
- The Run button shows what the query would scan and cost before it runs, from CloudWatch's free `estimate` command. It updates on its own shortly after the log groups or range change, and after a pause in typing or when the editor loses focus.
- Results layout switch above the histogram. "Query pinned" (default) fits the page to the window, so only the table scrolls; "Query scrolls away" scrolls the page and the table as one, so the table can take the whole window. No more two scrollbars, one inside the other.
- The line above the histogram no longer wraps: stats that do not fit are left out from the end, and on narrow pages the buttons show only icons.
- Running a tab again while it is still running no longer ends its running state early, and an older run can no longer replace the newer one's results.

## 1.0.3

- Absolute time range: a calendar in the From and To fields picks the days and the time of each end, in the selected time zone.
- Query editor checks queries against the documented Logs Insights syntax, since Grafana 10.4 hides CloudWatch's own errors behind "An error occurred within the plugin". Errors are underlined in red, unknown commands and functions in yellow; once a query fails, likely causes are underlined too and listed in the error.
- Highlighting, checks and autocomplete read queries the same way. Autocomplete follows the position (commands, fields and functions, asc/desc), works after `(`, `,` and `|`, and quotes field names that need backticks.
- Autocomplete remembers the raw log fields of each log group's last 20 queries.
- Table filters on fields like `request-id` quote the name instead of subtracting; a commented-out `sort` no longer re-sorts the table.
- Sideways swipes over the results table no longer navigate the browser back or forward.

## 1.0.2

- Results table: switching tabs keeps each tab's view and the page scroll position; scrolling and tab switching are faster.
- The column filter menu is no longer hidden behind the table toolbar.
- The Columns menu splits its height 60/40 between table columns and raw log fields.

## 1.0.1

- The app is enabled automatically (`autoEnabled`), so it survives Grafana restarts without a persistent database.
- Works without the Configuration page: region defaults to us-east-2, price to $0.005/GB, data source to the first CloudWatch one.
- Readable error messages instead of `[object Object]`.

## 1.0.0 (Unreleased)

Initial release.
