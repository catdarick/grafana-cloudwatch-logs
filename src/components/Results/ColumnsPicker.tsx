import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Checkbox, IconButton, Toggletip, useStyles2 } from '@grafana/ui';
import { ColumnSettings } from '../../types';
import { moveColumn, orderColumns } from '../../utils/table';

interface Props {
  fields: string[];
  settings: ColumnSettings;
  onChange: (settings: ColumnSettings) => void;
}

/** Toolbar dropdown: show, hide and reorder columns, reset widths. */
export function ColumnsPicker({ fields, settings, onChange }: Props) {
  const s = useStyles2(getStyles);
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
          </div>
        ))}
      </div>
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
  menu: css({ width: 320, display: 'flex', flexDirection: 'column', gap: theme.spacing(1) }),
  list: css({ maxHeight: 360, overflowY: 'auto' }),
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
