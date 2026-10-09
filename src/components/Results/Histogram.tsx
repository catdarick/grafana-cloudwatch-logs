import React, { useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import type { TimeZone } from '@grafana/schema';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { Bin, Unloaded } from '../../utils/table';
import { formatTime } from '../../utils/timeRange';

export const LEVEL_ORDER = ['error', 'warning', 'other', 'debug'] as const;

interface Props {
  bins: Bin[];
  timeZone: TimeZone;
  /** Drag across bars (or click one) to zoom into them. */
  onZoom: (from: number, to: number) => void;
  /** Part of the range whose logs did not fit the limit, drawn hatched. */
  unloaded?: Unloaded;
  /** e.g. "300 of 27,177 matched logs", shown when the bars do not cover everything. */
  caption?: string;
  /** Clicking the hatched part runs the query for just that range. */
  onRunRange: (from: number, to: number) => void;
}

/** Logs over time for the loaded rows, stacked by level. */
export function Histogram({ bins, timeZone, onZoom, unloaded, caption, onRunRange }: Props) {
  const s = useStyles2(getStyles);
  const theme = useTheme2();
  const [drag, setDrag] = useState<{ start: number; end: number }>();
  // Our own tooltip: the native title one only appears after a delay.
  const [hover, setHover] = useState<number>();
  const [hoverGap, setHoverGap] = useState(false);
  const max = Math.max(1, ...bins.map((b) => b.total));
  const colors: Record<string, string> = {
    error: theme.colors.error.main,
    warning: theme.colors.warning.main,
    other: theme.colors.primary.main,
    debug: theme.colors.text.disabled,
  };
  const start = bins.length ? bins[0].start : 0;
  const span = bins.length ? bins[bins.length - 1].end - start : 0;
  // The hatched part, clipped to what the bars show (zoom can cut it).
  const gap =
    unloaded && span > 0
      ? {
          from: Math.max(unloaded.from, start),
          to: Math.min(unloaded.to, start + span),
          whole: unloaded.from >= start && unloaded.to <= start + span,
        }
      : undefined;
  const showGap = gap && gap.to > gap.from;
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
      <div
        className={s.bars}
        onMouseLeave={() => {
          setDrag(undefined);
          setHover(undefined);
        }}
        onMouseUp={finish}
      >
        {showGap && unloaded && (
          <div
            className={s.gap}
            style={{ left: `${((gap.from - start) / span) * 100}%`, width: `${((gap.to - gap.from) / span) * 100}%` }}
            onMouseEnter={() => {
              setHover(undefined);
              setHoverGap(true);
            }}
            onMouseLeave={() => setHoverGap(false)}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onClick={() => onRunRange(gap.from, gap.to)}
          />
        )}
        {bins.map((bin, i) => (
          <div
            key={i}
            className={cx(s.slot, inDrag(i) && s.selected)}
            onMouseDown={(e) => {
              e.preventDefault();
              setDrag({ start: i, end: i });
            }}
            onMouseEnter={() => {
              setHover(i);
              if (drag) {
                setDrag({ ...drag, end: i });
              }
            }}
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
      {hover !== undefined && bins[hover] && (
        <div
          className={s.tooltip}
          style={{
            left: `${((hover + 0.5) / bins.length) * 100}%`,
            transform: `translateX(${hover < bins.length / 2 ? '-20%' : '-80%'})`,
          }}
        >
          <div className={s.tooltipTime}>
            {drag && drag.start !== drag.end
              ? `${formatTime(bins[Math.min(drag.start, drag.end)].start, timeZone, 'HH:mm:ss')} – ${formatTime(
                  bins[Math.max(drag.start, drag.end)].end,
                  timeZone,
                  'HH:mm:ss'
                )}`
              : `${formatTime(bins[hover].start, timeZone, 'HH:mm:ss')} – ${formatTime(bins[hover].end, timeZone, 'HH:mm:ss')}`}
          </div>
          <div className={s.tooltipTotal}>{bins[hover].total} logs</div>
          {LEVEL_ORDER.filter((l) => bins[hover].counts[l]).map((l) => (
            <div key={l} className={s.tooltipRow}>
              <span className={s.swatch} style={{ background: colors[l] }} />
              <span>{l === 'other' ? 'info / other' : l}</span>
              <span className={s.tooltipCount}>{bins[hover].counts[l]}</span>
            </div>
          ))}
          <div className={s.tooltipHint}>Click or drag to zoom</div>
        </div>
      )}
      {hoverGap && showGap && unloaded && (
        <div
          className={s.tooltip}
          style={{
            left: `${((gap.from + (gap.to - gap.from) / 2 - start) / span) * 100}%`,
            transform: 'translateX(-50%)',
          }}
        >
          <div className={s.tooltipTime}>
            {formatTime(gap.from, timeZone, 'HH:mm:ss')} – {formatTime(gap.to, timeZone, 'HH:mm:ss')}
          </div>
          <div className={s.tooltipTotal}>
            {gap.whole
              ? `${unloaded.count.toLocaleString('en-US')} logs not loaded`
              : `Part of ${unloaded.count.toLocaleString('en-US')} logs not loaded`}
          </div>
          <div>They matched the query but did not fit its limit.</div>
          <div className={s.tooltipHint}>Click to run the query for this range</div>
        </div>
      )}
      {bins.length > 0 && (
        <div className={s.axis}>
          <span>{formatTime(bins[0].start, timeZone, format)}</span>
          <span className={s.axisMiddle}>
            {formatTime(bins[Math.floor(bins.length / 2)].start, timeZone, format)}
            {caption && <span className={s.caption}>{caption}</span>}
          </span>
          <span>{formatTime(bins[bins.length - 1].end, timeZone, format)}</span>
        </div>
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    userSelect: 'none',
  }),
  gap: css({
    position: 'absolute',
    top: 0,
    bottom: 0,
    zIndex: 1,
    cursor: 'pointer',
    borderRadius: 2,
    border: `1px dashed ${theme.colors.border.medium}`,
    backgroundImage: `repeating-linear-gradient(135deg, ${theme.colors.text.disabled} 0 1px, transparent 1px 7px)`,
    opacity: 0.6,
    '&:hover': { opacity: 1, borderColor: theme.colors.primary.border },
  }),
  axisMiddle: css({ display: 'flex', gap: theme.spacing(1) }),
  caption: css({ color: theme.colors.warning.text }),
  tooltip: css({
    position: 'absolute',
    bottom: 'calc(100% - 4px)',
    zIndex: 4,
    minWidth: 160,
    padding: theme.spacing(1),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
    boxShadow: theme.shadows.z3,
    fontSize: theme.typography.bodySmall.fontSize,
    pointerEvents: 'none',
    fontVariantNumeric: 'tabular-nums',
  }),
  tooltipTime: css({ color: theme.colors.text.secondary }),
  tooltipTotal: css({ fontWeight: theme.typography.fontWeightMedium, marginBottom: theme.spacing(0.5) }),
  tooltipRow: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(0.75) }),
  swatch: css({ width: 8, height: 8, borderRadius: 2 }),
  tooltipCount: css({ marginLeft: 'auto', paddingLeft: theme.spacing(2) }),
  tooltipHint: css({ marginTop: theme.spacing(0.5), color: theme.colors.text.disabled }),
  bars: css({
    position: 'relative',
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
