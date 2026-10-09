import React, { useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import type { TimeZone } from '@grafana/schema';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { Bin } from '../../utils/table';
import { formatTime } from '../../utils/timeRange';

const MIN_BARS = 3;

export const LEVEL_ORDER = ['error', 'warning', 'other', 'debug'] as const;

export interface Gap {
  from: number;
  to: number;
  /** Logs that did not fit the limit; all of them are somewhere in the full unloaded range. */
  count: number;
  /** False when zoom shows only part of the unloaded range, so the count is not all in view. */
  whole: boolean;
}

interface Props {
  /** The time axis shown: the query range, or the zoom window. */
  view: { from: number; to: number };
  /** Bins over the loaded part of the view; they end exactly where the gap starts (or the reverse). */
  bins: Bin[];
  /** All loaded rows in the view, when filters or search hide some; same bins, drawn faintly. */
  ghost?: Bin[];
  timeZone: TimeZone;
  /** Drag across bars (or click one) to zoom into them. */
  onZoom: (from: number, to: number) => void;
  /** Part of the view whose logs did not fit the limit, drawn hatched. */
  gap?: Gap;
  /** e.g. "300 of 27,177 matched logs", shown when the bars do not cover everything. */
  caption?: string;
  /** Clicking the hatched part runs the query for just that range. */
  onRunRange: (from: number, to: number) => void;
}

/** Logs over time for the loaded rows, stacked by level. */
export function Histogram({ view, bins, ghost, timeZone, onZoom, gap, caption, onRunRange }: Props) {
  const s = useStyles2(getStyles);
  const theme = useTheme2();
  const [drag, setDrag] = useState<{ start: number; end: number }>();
  // Our own tooltip: the native title one only appears after a delay.
  const [hover, setHover] = useState<number>();
  const [hoverGap, setHoverGap] = useState(false);
  const max = Math.max(1, ...(ghost ?? bins).map((b) => b.total));
  const colors: Record<string, string> = {
    error: theme.colors.error.main,
    warning: theme.colors.warning.main,
    other: theme.colors.primary.main,
    debug: theme.colors.text.disabled,
  };
  const span = Math.max(1, view.to - view.from);
  const format = span > 2 * 86400000 ? 'MM-DD HH:mm' : span > 3600000 ? 'HH:mm' : 'HH:mm:ss';
  const inDrag = (i: number) => drag && i >= Math.min(drag.start, drag.end) && i <= Math.max(drag.start, drag.end);
  const barsFrom = bins.length ? bins[0].start : view.from;
  const barsTo = bins.length ? bins[bins.length - 1].end : view.from;
  // Layout in % of the track. A few loaded seconds on a long axis would be a 1px sliver, so the bars
  // get at least MIN_BARS% and the hatching gives way; the times in tooltips stay exact.
  let barsShare = ((barsTo - barsFrom) / span) * 100;
  if (gap && bins.length) {
    barsShare = Math.max(barsShare, MIN_BARS);
  }
  const gapFirst = gap !== undefined && gap.from <= view.from;
  const barsLeft = gapFirst ? 100 - barsShare : ((barsFrom - view.from) / span) * 100;
  const gapLeft = gapFirst ? 0 : barsLeft + barsShare;
  const gapWidth = gap ? (gapFirst ? 100 - barsShare : 100 - gapLeft) : 0;

  const finish = () => {
    if (drag) {
      const a = Math.min(drag.start, drag.end);
      const b = Math.max(drag.start, drag.end);
      onZoom(bins[a].start, bins[b].end);
    }
    setDrag(undefined);
  };

  const hovered = hover !== undefined ? bins[hover] : undefined;
  const range = (a: number, b: number) =>
    `${formatTime(a, timeZone, 'HH:mm:ss')} – ${formatTime(b, timeZone, 'HH:mm:ss')}`;

  return (
    <div className={s.wrapper}>
      <div className={s.track}>
        <div
          className={s.bars}
          style={{ left: `${barsLeft}%`, width: `${barsShare}%` }}
          onMouseLeave={() => {
            setDrag(undefined);
            setHover(undefined);
          }}
          onMouseUp={finish}
        >
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
              {ghost?.[i] && ghost[i].total > 0 && (
                <div className={cx(s.stack, s.ghost)} style={{ height: `${(ghost[i].total / max) * 100}%` }}>
                  {LEVEL_ORDER.map((level) =>
                    ghost[i].counts[level] ? (
                      <div
                        key={level}
                        style={{ flexGrow: ghost[i].counts[level], background: colors[level] }}
                        className={s.segment}
                      />
                    ) : null
                  )}
                </div>
              )}
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
        {gap && (
          <div
            className={s.gap}
            style={{ left: `${gapLeft}%`, width: `${gapWidth}%` }}
            onMouseEnter={() => setHoverGap(true)}
            onMouseLeave={() => setHoverGap(false)}
            onClick={() => onRunRange(gap.from, gap.to)}
          />
        )}
      </div>
      {hovered && hover !== undefined && (
        <div
          className={s.tooltip}
          style={{
            left: `${barsLeft + ((hover + 0.5) / bins.length) * barsShare}%`,
            transform: `translateX(${barsLeft + (hover / bins.length) * barsShare < 50 ? '-20%' : '-80%'})`,
          }}
        >
          <div className={s.tooltipTime}>
            {drag && drag.start !== drag.end
              ? range(bins[Math.min(drag.start, drag.end)].start, bins[Math.max(drag.start, drag.end)].end)
              : range(hovered.start, hovered.end)}
          </div>
          <div className={s.tooltipTotal}>
            {ghost && hover !== undefined && ghost[hover]
              ? `${hovered.total} of ${ghost[hover].total} logs shown`
              : `${hovered.total} logs`}
          </div>
          {LEVEL_ORDER.filter((l) => hovered.counts[l]).map((l) => (
            <div key={l} className={s.tooltipRow}>
              <span className={s.swatch} style={{ background: colors[l] }} />
              <span>{l === 'other' ? 'info / other' : l}</span>
              <span className={s.tooltipCount}>{hovered.counts[l]}</span>
            </div>
          ))}
          <div className={s.tooltipHint}>Click or drag to zoom</div>
        </div>
      )}
      {hoverGap && gap && (
        <div className={s.tooltip} style={{ left: `${gapLeft + gapWidth / 2}%`, transform: 'translateX(-50%)' }}>
          <div className={s.tooltipTime}>{range(gap.from, gap.to)}</div>
          <div className={s.tooltipTotal}>
            {gap.whole
              ? `${gap.count.toLocaleString('en-US')} logs not loaded`
              : `Part of ${gap.count.toLocaleString('en-US')} logs not loaded`}
          </div>
          <div>They matched the query but did not fit its limit.</div>
          <div className={s.tooltipHint}>Click to run the query for this range</div>
        </div>
      )}
      <div className={s.axis}>
        <span>{formatTime(view.from, timeZone, format)}</span>
        <span className={s.axisMiddle}>
          {formatTime(view.from + span / 2, timeZone, format)}
          {caption && <span className={s.caption}>{caption}</span>}
        </span>
        <span>{formatTime(view.to, timeZone, format)}</span>
      </div>
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
    top: 4,
    bottom: 4,
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
  track: css({
    position: 'relative',
    height: 56,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  // The bars cover only the loaded part of the axis; positioned in % of the whole range.
  bars: css({
    position: 'absolute',
    top: 4,
    bottom: 4,
    display: 'flex',
    alignItems: 'flex-end',
    gap: 2,
  }),
  slot: css({
    position: 'relative',
    flex: 1,
    height: '100%',
    display: 'flex',
    alignItems: 'flex-end',
    cursor: 'zoom-in',
    borderRadius: 2,
    '&:hover': { background: theme.colors.action.hover },
  }),
  selected: css({ background: theme.colors.action.selected }),
  // Positioned so it paints over the ghost bar behind it.
  stack: css({
    position: 'relative',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    borderRadius: '2px 2px 0 0',
    overflow: 'hidden',
  }),
  segment: css({ minHeight: 1, opacity: 0.85 }),
  // Rows hidden by filters or search: same bar, faint, behind the visible one.
  ghost: css({ position: 'absolute', left: 0, right: 0, bottom: 0, opacity: 0.22 }),
  axis: css({
    display: 'flex',
    justifyContent: 'space-between',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontVariantNumeric: 'tabular-nums',
  }),
});
