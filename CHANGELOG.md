# Changelog

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
