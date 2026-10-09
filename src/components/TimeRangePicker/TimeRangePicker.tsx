import React, { useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import type { TimeZone } from '@grafana/schema';
import { Input, RadioButtonGroup, useStyles2 } from '@grafana/ui';
import { TimeRangeValue } from '../../types';
import { parseRangeInput, parseTimeInput } from '../../utils/parseTime';
import { AMOUNTS, UNITS, formatTime, toEpochRange, zoneLabel } from '../../utils/timeRange';

interface Props {
  value: TimeRangeValue;
  /** Zone used to read and show absolute times; chosen in the page's top bar. */
  timeZone: TimeZone;
  onChange: (value: TimeRangeValue) => void;
}

const MODES = [
  { label: 'Relative', value: 'relative' as const },
  { label: 'Absolute', value: 'absolute' as const },
];

/** Relative/absolute picker with quick buttons, ported from the VS Code extension. */
export function TimeRangePicker({ value, timeZone, onChange }: Props) {
  const s = useStyles2(getStyles);
  // What the user typed in Custom. While it is non-empty the range counts as custom, even when the
  // number happens to match a quick button (typing "10" passes through "1").
  const [customText, setCustomText] = useState(() =>
    value.mode === 'relative' && !AMOUNTS.includes(value.amount) ? String(value.amount) : ''
  );
  const isCustom = customText !== '';

  const onModeChange = (mode: TimeRangeValue['mode']) => {
    if (mode === value.mode) {
      return;
    }
    if (mode === 'absolute') {
      // Start the absolute range from whatever the relative one currently covers.
      onChange({ mode: 'absolute', ...toEpochRange(value) });
    } else {
      setCustomText('');
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
                className={cx(s.cell, !isCustom && value.amount === amount && s.active)}
                onClick={() => {
                  setCustomText('');
                  onChange({ ...value, amount });
                }}
              >
                {amount}
              </button>
            ))}
            <Input
              className={cx(s.custom, isCustom && s.customActive)}
              type="number"
              min={1}
              placeholder="Custom"
              aria-label="Custom amount"
              value={customText}
              onChange={(e) => {
                const text = e.currentTarget.value;
                setCustomText(text);
                const amount = Number(text);
                if (Number.isInteger(amount) && amount > 0) {
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
          <TimeInput
            label="From"
            value={value.from}
            timeZone={timeZone}
            onCommit={(from) => onChange({ ...value, from })}
            onRange={(range) => onChange({ mode: 'absolute', ...range })}
          />
          <TimeInput
            label="To"
            value={value.to}
            timeZone={timeZone}
            onCommit={(to) => onChange({ ...value, to })}
            onRange={(range) => onChange({ mode: 'absolute', ...range })}
          />
          {value.from >= value.to && <span className={s.error}>From must be earlier than To</span>}
        </div>
      )}
    </div>
  );
}

interface TimeInputProps {
  label: string;
  value: number;
  timeZone: TimeZone;
  onCommit: (ms: number) => void;
  onRange: (range: { from: number; to: number }) => void;
}

/**
 * Free-text timestamp field: paste ISO, epoch, "08.10.2026 22:59", "now-1h" or a whole "A - B" range.
 * Text without an explicit offset is read in the selected time zone.
 */
function TimeInput({ label, value, timeZone, onCommit, onRange }: TimeInputProps) {
  const s = useStyles2(getStyles);
  const [draft, setDraft] = useState<string>();
  const parsed = draft === undefined ? value : parseTimeInput(draft, timeZone);
  const invalid = draft !== undefined && draft.trim() !== '' && parsed === undefined;

  const onTextChange = (text: string) => {
    const range = parseRangeInput(text, timeZone);
    if (range) {
      onRange(range);
      setDraft(undefined);
      return;
    }
    setDraft(text);
    const ms = parseTimeInput(text, timeZone);
    if (ms !== undefined) {
      onCommit(ms);
    }
  };

  return (
    <>
      <label className={s.absLabel}>{label}</label>
      <div className={s.absField}>
        <Input
          aria-label={label}
          invalid={invalid}
          value={draft ?? formatTime(value, timeZone)}
          placeholder="ISO, epoch, 08.10.2026 22:59, now-1h"
          onChange={(e) => onTextChange(e.currentTarget.value)}
          onBlur={() => setDraft(undefined)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          suffix={<span className={s.zone}>{zoneLabel(value, timeZone)}</span>}
        />
        {draft !== undefined && (
          <span className={invalid ? s.error : s.preview}>
            {invalid || parsed === undefined
              ? 'Cannot read this time'
              : `${formatTime(parsed, timeZone, 'YYYY-MM-DD HH:mm:ss.SSS')} ${zoneLabel(parsed, timeZone)}`}
          </span>
        )}
      </div>
    </>
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
  custom: css({ gridColumn: '1 / -1', input: { textAlign: 'center' } }),
  customActive: css({
    input: { borderColor: theme.colors.primary.border, boxShadow: `0 0 0 1px ${theme.colors.primary.border}` },
  }),
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
  absolute: css({ display: 'grid', gridTemplateColumns: 'auto 1fr', alignItems: 'start', gap: theme.spacing(1) }),
  absLabel: css({ color: theme.colors.text.secondary, margin: 0, lineHeight: theme.spacing(4) }),
  absField: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(0.5), minWidth: 0 }),
  zone: css({ color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize }),
  preview: css({ color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize }),
  error: css({ color: theme.colors.error.text, fontSize: theme.typography.bodySmall.fontSize, gridColumn: '2' }),
});
