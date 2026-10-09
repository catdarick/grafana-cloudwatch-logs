import React, { useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import type { TimeZone } from '@grafana/schema';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { Bin } from '../../utils/table';
import { formatTime } from '../../utils/timeRange';

export const LEVEL_ORDER = ['error', 'warning', 'other', 'debug'] as const;

interface Props {
  bins: Bin[];
  timeZone: TimeZone;
  /** Drag across bars (or click one) to narrow the time range to them. */
  onZoom: (from: number, to: number) => void;
}

/** Logs over time for the loaded rows, stacked by level. */
export function Histogram({ bins, timeZone, onZoom }: Props) {
  const s = useStyles2(getStyles);
  const theme = useTheme2();
  const [drag, setDrag] = useState<{ start: number; end: number }>();
  const max = Math.max(1, ...bins.map((b) => b.total));
  const colors: Record<string, string> = {
    error: theme.colors.error.main,
    warning: theme.colors.warning.main,
    other: theme.colors.primary.main,
    debug: theme.colors.text.disabled,
  };
  const span = bins.length ? bins[bins.length - 1].end - bins[0].start : 0;
  const format = span > 2 * 86400000 ? 'MM-DD HH:mm' : span > 3600000 ? 'HH:mm' : 'HH:mm:ss';
  const inDrag = (i: number) => drag && i >= Math.min(drag.start, drag.end) && i <= Math.max(drag.start, drag.end);

  const finish = () => {
    if (drag) {
      const a = Math.min(drag.start, drag.end);
      const b = Math.max(drag.start, drag.end);
      onZoom(bins[a].start, bins[b].end);
    }
    setDrag(undefined);
  };

  return (
    <div className={s.wrapper}>
      <div className={s.bars} onMouseLeave={() => setDrag(undefined)} onMouseUp={finish}>
        {bins.map((bin, i) => (
          <div
            key={i}
            className={cx(s.slot, inDrag(i) && s.selected)}
            title={tooltip(bin, timeZone)}
            onMouseDown={(e) => {
              e.preventDefault();
              setDrag({ start: i, end: i });
            }}
            onMouseEnter={() => drag && setDrag({ ...drag, end: i })}
          >
            <div className={s.stack} style={{ height: `${(bin.total / max) * 100}%` }}>
              {LEVEL_ORDER.map((level) =>
                bin.counts[level] ? (
                  <div
                    key={level}
                    style={{ flexGrow: bin.counts[level], background: colors[level] }}
                    className={s.segment}
                  />
                ) : null
              )}
            </div>
          </div>
        ))}
      </div>
      {bins.length > 0 && (
        <div className={s.axis}>
          <span>{formatTime(bins[0].start, timeZone, format)}</span>
          <span>{formatTime(bins[Math.floor(bins.length / 2)].start, timeZone, format)}</span>
          <span>{formatTime(bins[bins.length - 1].end, timeZone, format)}</span>
        </div>
      )}
    </div>
  );
}

function tooltip(bin: Bin, timeZone: TimeZone): string {
  const range = `${formatTime(bin.start, timeZone, 'HH:mm:ss')} – ${formatTime(bin.end, timeZone, 'HH:mm:ss')}`;
  const levels = LEVEL_ORDER.filter((l) => bin.counts[l])
    .map((l) => `${bin.counts[l]} ${l === 'other' ? 'info/other' : l}`)
    .join(', ');
  return `${range}\n${bin.total} logs${levels ? ` (${levels})` : ''}\nClick or drag to zoom in`;
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(0.5), userSelect: 'none' }),
  bars: css({
    display: 'flex',
    alignItems: 'flex-end',
    gap: 2,
    height: 56,
    padding: theme.spacing(0.5, 0),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  slot: css({
    flex: 1,
    height: '100%',
    display: 'flex',
    alignItems: 'flex-end',
    cursor: 'zoom-in',
    borderRadius: 2,
    '&:hover': { background: theme.colors.action.hover },
  }),
  selected: css({ background: theme.colors.action.selected }),
  stack: css({
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    borderRadius: '2px 2px 0 0',
    overflow: 'hidden',
  }),
  segment: css({ minHeight: 1, opacity: 0.85 }),
  axis: css({
    display: 'flex',
    justifyContent: 'space-between',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontVariantNumeric: 'tabular-nums',
  }),
});
