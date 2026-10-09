import React, { useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Checkbox, FilterInput, Icon, IconButton, Toggletip, useStyles2 } from '@grafana/ui';
import { ColumnSettings } from '../../types';
import { moveColumn, orderColumns } from '../../utils/table';

interface Props {
  /** Query fields plus the ones added from the raw log. */
  fields: string[];
  /** The added ones, which can be removed again. */
  extra: string[];
  /** Fields found in the raw JSON logs that are not columns, most common first. */
  rawKeys: Array<{ name: string; count: number }>;
  rowCount: number;
  settings: ColumnSettings;
  onChange: (settings: ColumnSettings) => void;
}

/** Toolbar dropdown: show, hide and reorder columns, reset widths. */
export function ColumnsPicker({ fields, extra, rawKeys, rowCount, settings, onChange }: Props) {
  const s = useStyles2(getStyles);
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const candidates = rawKeys.filter((k) => !fields.includes(k.name) && k.name.toLowerCase().includes(needle));

  const addExtra = (name: string) => onChange({ ...settings, extra: [...extra, name] });
  const removeExtra = (name: string) =>
    onChange({
      ...settings,
      extra: extra.filter((f) => f !== name),
      order: settings.order?.filter((f) => f !== name),
      hidden: settings.hidden?.filter((f) => f !== name),
    });
  const order = orderColumns(fields, settings);
  const hidden = new Set(settings.hidden ?? []);
  const hiddenCount = fields.filter((f) => hidden.has(f)).length;

  const toggle = (field: string) => {
    const next = new Set(hidden);
    next.has(field) ? next.delete(field) : next.add(field);
    onChange({ ...settings, hidden: Array.from(next) });
  };

  const content = (
    <div className={s.menu}>
      <div className={s.list}>
        {order.map((field, i) => (
          <div key={field} className={s.item}>
            <Checkbox value={!hidden.has(field)} onChange={() => toggle(field)} />
            <span className={s.name} title={field}>
              {field}
            </span>
            <IconButton
              name="arrow-up"
              size="sm"
              aria-label={`Move ${field} left`}
              disabled={i === 0}
              onClick={() => onChange({ ...settings, order: moveColumn(order, field, -1) })}
            />
            <IconButton
              name="arrow-down"
              size="sm"
              aria-label={`Move ${field} right`}
              disabled={i === order.length - 1}
              onClick={() => onChange({ ...settings, order: moveColumn(order, field, 1) })}
            />
            {extra.includes(field) ? (
              <IconButton name="times" size="sm" tooltip="Remove column" onClick={() => removeExtra(field)} />
            ) : (
              <span className={s.spacer} />
            )}
          </div>
        ))}
      </div>
      {rawKeys.length > 0 && (
        <div className={s.raw}>
          <div className={s.rawTitle}>Add from raw log</div>
          <FilterInput placeholder="Search fields" value={search} onChange={setSearch} />
          <div className={s.rawList}>
            {candidates.slice(0, 200).map((k) => (
              <button key={k.name} type="button" className={s.rawItem} onClick={() => addExtra(k.name)}>
                <Icon name="plus" size="sm" />
                <span className={s.name} title={k.name}>
                  {k.name}
                </span>
                <span className={s.count} title={`Present in ${k.count} of ${rowCount} rows`}>
                  {Math.round((k.count / Math.max(1, rowCount)) * 100)}%
                </span>
              </button>
            ))}
            {candidates.length === 0 && <div className={s.empty}>{needle ? 'Nothing found' : 'All added'}</div>}
          </div>
        </div>
      )}
      <div className={s.footer}>
        <Button size="sm" variant="secondary" onClick={() => onChange({ ...settings, hidden: [] })}>
          Show all
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onChange({ ...settings, widths: {} })}>
          Reset widths
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onChange({})}>
          Reset all
        </Button>
      </div>
    </div>
  );

  return (
    <Toggletip placement="bottom-end" fitContent content={content}>
      <Button size="sm" variant="secondary" icon="columns">
        Columns{hiddenCount > 0 ? ` (${fields.length - hiddenCount}/${fields.length})` : ''}
      </Button>
    </Toggletip>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  spacer: css({ width: 24, flexShrink: 0 }),
  raw: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    paddingTop: theme.spacing(1),
    borderTop: `1px solid ${theme.colors.border.weak}`,
  }),
  rawTitle: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  }),
  rawList: css({ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column' }),
  rawItem: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5),
    border: 'none',
    borderRadius: theme.shape.radius.default,
    background: 'transparent',
    color: theme.colors.text.primary,
    textAlign: 'left',
    cursor: 'pointer',
    '&:hover': { background: theme.colors.action.hover },
  }),
  count: css({ color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize }),
  empty: css({ padding: theme.spacing(0.5), color: theme.colors.text.secondary }),
  menu: css({ width: 360, display: 'flex', flexDirection: 'column', gap: theme.spacing(1) }),
  list: css({ maxHeight: 280, overflowY: 'auto' }),
  item: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.25, 0.5),
    borderRadius: theme.shape.radius.default,
    '&:hover': { background: theme.colors.action.hover },
  }),
  name: css({ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
  footer: css({ display: 'flex', gap: theme.spacing(1), '& > *': { flex: 1, justifyContent: 'center' } }),
});
