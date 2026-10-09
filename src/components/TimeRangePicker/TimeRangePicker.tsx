import React from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2, dateTime } from '@grafana/data';
import { DateTimePicker, Input, RadioButtonGroup, useStyles2 } from '@grafana/ui';
import { TimeRangeValue } from '../../types';
import { AMOUNTS, UNITS, toEpochRange } from '../../utils/timeRange';

interface Props {
  value: TimeRangeValue;
  onChange: (value: TimeRangeValue) => void;
}

const MODES = [
  { label: 'Relative', value: 'relative' as const },
  { label: 'Absolute', value: 'absolute' as const },
];

/** Relative/absolute picker with quick buttons, ported from the VS Code extension. */
export function TimeRangePicker({ value, onChange }: Props) {
  const s = useStyles2(getStyles);

  const onModeChange = (mode: TimeRangeValue['mode']) => {
    if (mode === value.mode) {
      return;
    }
    if (mode === 'absolute') {
      // Start the absolute range from whatever the relative one currently covers.
      onChange({ mode: 'absolute', ...toEpochRange(value) });
    } else {
      onChange({ mode: 'relative', amount: 30, unit: 'minutes' });
    }
  };

  return (
    <div className={s.container}>
      <RadioButtonGroup fullWidth options={MODES} value={value.mode} onChange={onModeChange} />
      {value.mode === 'relative' ? (
        <div className={s.relative}>
          <span className={s.last}>Last</span>
          <div className={s.amounts}>
            {AMOUNTS.map((amount) => (
              <button
                key={amount}
                type="button"
                className={cx(s.cell, value.amount === amount && s.active)}
                onClick={() => onChange({ ...value, amount })}
              >
                {amount}
              </button>
            ))}
            <Input
              className={s.custom}
              type="number"
              min={1}
              placeholder="Custom"
              aria-label="Custom amount"
              value={AMOUNTS.includes(value.amount) ? '' : value.amount}
              onChange={(e) => {
                const amount = Number(e.currentTarget.value);
                if (amount > 0) {
                  onChange({ ...value, amount });
                }
              }}
            />
          </div>
          <div className={s.units}>
            {UNITS.map((unit) => (
              <button
                key={unit}
                type="button"
                className={cx(s.cell, value.unit === unit && s.active)}
                onClick={() => onChange({ ...value, unit })}
              >
                {unit}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className={s.absolute}>
          <label className={s.absLabel}>From</label>
          <DateTimePicker
            showSeconds
            date={dateTime(value.from)}
            onChange={(d) => onChange({ ...value, from: d.valueOf() })}
          />
          <label className={s.absLabel}>To</label>
          <DateTimePicker
            showSeconds
            date={dateTime(value.to)}
            onChange={(d) => onChange({ ...value, to: d.valueOf() })}
          />
        </div>
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(2) }),
  relative: css({
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  last: css({ color: theme.colors.text.secondary }),
  amounts: css({ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(32px, 1fr))', gap: theme.spacing(0.5) }),
  custom: css({ gridColumn: '1 / -1' }),
  units: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(0.5) }),
  cell: css({
    height: theme.spacing(4),
    padding: theme.spacing(0, 1),
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
    color: theme.colors.text.primary,
    cursor: 'pointer',
    '&:hover': { background: theme.colors.action.hover },
  }),
  active: css({
    background: theme.colors.primary.main,
    borderColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    '&:hover': { background: theme.colors.primary.shade },
  }),
  absolute: css({ display: 'grid', gridTemplateColumns: 'auto 1fr', alignItems: 'center', gap: theme.spacing(1) }),
  absLabel: css({ color: theme.colors.text.secondary, margin: 0 }),
});
