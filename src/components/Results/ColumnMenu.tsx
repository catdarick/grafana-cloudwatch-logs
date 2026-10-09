import React, { useMemo, useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Checkbox, FilterInput, IconButton, Toggletip, useStyles2 } from '@grafana/ui';
import { ValueCount } from '../../utils/table';

interface Props {
  field: string;
  /** Called only while the menu is open, so closed menus cost nothing. */
  getValues: () => ValueCount[];
  /** Allowed values; undefined means no filter on this column. */
  allowed?: Set<string>;
  onChange: (allowed: Set<string> | undefined) => void;
  onHide: () => void;
  onMove: (offset: number) => void;
}

const MAX_VALUES = 300;

/** The ⋮ button in a column header: filter by value with counts, hide or move the column. */
export function ColumnMenu(props: Props) {
  const s = useStyles2(getStyles);
  const [open, setOpen] = useState(false);
  const active = props.allowed !== undefined;

  return (
    <Toggletip
      placement="bottom-end"
      fitContent
      show={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      content={open ? <MenuContent {...props} /> : <></>}
    >
      <IconButton
        className={cx(s.trigger, active && s.active)}
        name={active ? 'filter' : 'ellipsis-v'}
        size="sm"
        aria-label={active ? `Filtered: ${props.field}` : `Column menu for ${props.field}`}
      />
    </Toggletip>
  );
}

function MenuContent({ field, getValues, allowed, onChange, onHide, onMove }: Props) {
  const s = useStyles2(getStyles);
  const [search, setSearch] = useState('');
  // Taken once on open: ticking a box should not reshuffle the list under the cursor.
  const [values] = useState(getValues);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? values.filter((v) => v.value.toLowerCase().includes(needle)) : values;
  }, [values, search]);

  const isChecked = (value: string) => !allowed || allowed.has(value);

  const toggle = (value: string) => {
    const next = new Set(allowed ?? values.map((v) => v.value));
    next.has(value) ? next.delete(value) : next.add(value);
    onChange(next.size === values.length ? undefined : next);
  };

  // With a search, the bulk buttons act on the matching values only.
  const setShown = (checked: boolean) => {
    if (!search.trim()) {
      onChange(checked ? undefined : new Set());
      return;
    }
    const next = new Set(allowed ?? values.map((v) => v.value));
    shown.forEach((v) => (checked ? next.add(v.value) : next.delete(v.value)));
    onChange(next.size === values.length ? undefined : next);
  };

  return (
    <div className={s.menu}>
      <div className={s.header}>
        <span className={s.title}>Filter: {field}</span>
        <IconButton name="arrow-left" size="sm" aria-label="Move column left" onClick={() => onMove(-1)} />
        <IconButton name="arrow-right" size="sm" aria-label="Move column right" onClick={() => onMove(1)} />
        <IconButton name="eye-slash" size="sm" aria-label="Hide column" tooltip="Hide column" onClick={onHide} />
      </div>
      <FilterInput placeholder="Search values..." value={search} onChange={setSearch} autoFocus />
      <div className={s.list}>
        {shown.slice(0, MAX_VALUES).map(({ value, count }) => (
          <div key={value} className={cx(s.item, count === 0 && s.zero)} title={value}>
            <Checkbox
              className={s.value}
              label={value === '' ? '(empty)' : value}
              value={isChecked(value)}
              onChange={() => toggle(value)}
            />
            <span className={s.count}>{count}</span>
          </div>
        ))}
        {shown.length === 0 && <div className={s.note}>No values</div>}
        {shown.length > MAX_VALUES && (
          <div className={s.note}>
            Showing {MAX_VALUES} of {shown.length}, narrow the search
          </div>
        )}
      </div>
      <div className={s.footer}>
        <Button size="sm" variant="secondary" onClick={() => setShown(true)}>
          Select all
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setShown(false)}>
          Clear
        </Button>
      </div>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  trigger: css({ margin: 0, opacity: 0.6, '&:hover': { opacity: 1 } }),
  active: css({ opacity: 1, color: theme.colors.primary.text }),
  menu: css({
    width: 320,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    fontWeight: theme.typography.fontWeightRegular,
    whiteSpace: 'normal',
    textAlign: 'left',
  }),
  header: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(0.5) }),
  title: css({
    flex: 1,
    fontWeight: theme.typography.fontWeightMedium,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  list: css({ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column' }),
  item: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5),
    borderRadius: theme.shape.radius.default,
    '&:hover': { background: theme.colors.action.hover },
  }),
  zero: css({ color: theme.colors.text.disabled }),
  value: css({
    flex: 1,
    minWidth: 0,
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    '& > span:last-child': { maxWidth: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  }),
  count: css({
    padding: theme.spacing(0, 1),
    borderRadius: theme.shape.radius.pill,
    background: theme.colors.background.secondary,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  note: css({ padding: theme.spacing(0.5), color: theme.colors.text.secondary }),
  footer: css({ display: 'flex', gap: theme.spacing(1), '& > *': { flex: 1, justifyContent: 'center' } }),
});
