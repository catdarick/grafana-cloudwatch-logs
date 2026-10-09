import React, { useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import type { TimeZone } from '@grafana/schema';
import { FilterInput, IconButton, useStyles2 } from '@grafana/ui';
import { QueryResult } from '../../types';
import { formatTime } from '../../utils/timeRange';

interface Props {
  result: QueryResult;
  timeZone: TimeZone;
}

const PAGE = 500;
const LEVEL_FIELDS = ['severity', 'level', 'loglevel', 'log_level', 'lvl'];

type Level = 'error' | 'warning' | 'debug' | undefined;

function rowLevel(row: Record<string, string>, levelField?: string): Level {
  const value = levelField ? row[levelField]?.toLowerCase() : undefined;
  if (!value) {
    return undefined;
  }
  if (/err|fatal|crit|panic|emerg|alert/.test(value)) {
    return 'error';
  }
  if (/warn/.test(value)) {
    return 'warning';
  }
  if (/debug|trace/.test(value)) {
    return 'debug';
  }
  return undefined;
}

export function ResultsTable({ result, timeZone }: Props) {
  const s = useStyles2(getStyles);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [shown, setShown] = useState(PAGE);

  // Time fields arrive as epoch millis; show them in the selected zone.
  const displayRows = useMemo(
    () =>
      result.rows.map((row) => {
        const out = { ...row };
        for (const f of result.timeFields) {
          if (out[f] !== undefined) {
            out[f] = formatTime(Number(out[f]), timeZone, 'YYYY-MM-DD HH:mm:ss.SSS');
          }
        }
        return out;
      }),
    [result, timeZone]
  );

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const indexed = displayRows.map((row, index) => ({ row, index }));
    if (!needle) {
      return indexed;
    }
    return indexed.filter(({ row }) => Object.values(row).some((v) => v.toLowerCase().includes(needle)));
  }, [displayRows, filter]);

  const levelField = result.fields.find((f) => LEVEL_FIELDS.includes(f.toLowerCase()));

  const toggle = (index: number) => {
    const next = new Set(expanded);
    next.has(index) ? next.delete(index) : next.add(index);
    setExpanded(next);
  };

  return (
    <div className={s.wrapper}>
      <div className={s.toolbar}>
        <FilterInput placeholder="Filter rows" value={filter} onChange={setFilter} width={40} />
        <span className={s.count}>{filter ? `${rows.length} of ${result.rows.length}` : result.rows.length} rows</span>
      </div>
      <div className={s.scroll}>
        <table className={s.table}>
          <thead>
            <tr>
              <th className={s.expandCol} />
              {result.fields.map((f) => (
                <th key={f}>{f}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map(({ row, index }) => (
              <React.Fragment key={index}>
                <tr className={s.level[rowLevel(row, levelField) ?? 'none']}>
                  <td className={s.expandCol}>
                    <IconButton
                      size="sm"
                      name={expanded.has(index) ? 'angle-down' : 'angle-right'}
                      aria-label="Toggle row details"
                      onClick={() => toggle(index)}
                    />
                  </td>
                  {result.fields.map((f) => (
                    <td key={f}>{row[f] ?? ''}</td>
                  ))}
                </tr>
                {expanded.has(index) && (
                  <tr>
                    <td />
                    <td colSpan={result.fields.length}>
                      <pre className={s.details}>{JSON.stringify(row, null, 2)}</pre>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown && (
        <button type="button" className={s.more} onClick={() => setShown(shown + PAGE)}>
          Show {Math.min(PAGE, rows.length - shown)} more
        </button>
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(1), minHeight: 0 }),
  toolbar: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(2) }),
  count: css({ color: theme.colors.text.secondary }),
  scroll: css({
    overflow: 'auto',
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
  }),
  table: css({
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: theme.typography.bodySmall.fontSize,
    'th, td': {
      padding: theme.spacing(0.75, 1),
      textAlign: 'left',
      verticalAlign: 'top',
      borderBottom: `1px solid ${theme.colors.border.weak}`,
      wordBreak: 'break-word',
    },
    th: {
      position: 'sticky',
      top: 0,
      background: theme.colors.background.secondary,
      fontWeight: theme.typography.fontWeightMedium,
      whiteSpace: 'nowrap',
    },
    'tbody tr:hover': { background: theme.colors.action.hover },
  }),
  expandCol: css({ width: 32 }),
  level: {
    none: css({}),
    error: css({ 'td:first-child': { boxShadow: `inset 3px 0 ${theme.colors.error.main}` } }),
    warning: css({ 'td:first-child': { boxShadow: `inset 3px 0 ${theme.colors.warning.main}` } }),
    debug: css({ color: theme.colors.text.secondary }),
  },
  details: css({ margin: 0, whiteSpace: 'pre-wrap', fontSize: theme.typography.bodySmall.fontSize }),
  more: css({
    alignSelf: 'center',
    background: 'none',
    border: 'none',
    color: theme.colors.text.link,
    cursor: 'pointer',
  }),
});
