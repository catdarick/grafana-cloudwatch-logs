import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Calendar from 'react-calendar';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2, colorManipulator, dateTime } from '@grafana/data';
import type { TimeZone } from '@grafana/schema';
import { Button, Icon, TimeOfDayPicker, useStyles2 } from '@grafana/ui';
import { parseTimeInput } from '../../utils/parseTime';
import { formatTime, zoneLabel } from '../../utils/timeRange';

// The time picker's dropdown is rendered at the end of the page, outside the popup: clicks in it
// must not close the popup. The class is TimeOfDayPicker's POPUP_CLASS_NAME, not exported.
const TIME_PANEL = '.time-of-day-picker-panel';
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export type RangeEnd = 'from' | 'to';

interface Props {
  from: number;
  to: number;
  /** Zone the days and times are picked in. */
  timeZone: TimeZone;
  /** The end a day click sets: the one whose field opened the popup, until another is chosen. */
  active: RangeEnd;
  onActiveChange: (end: RangeEnd) => void;
  /** Offset from the top of the fields block: right below the field that opened the popup. */
  top: number;
  onApply: (range: { from: number; to: number }) => void;
  /** Closes without applying. */
  onClose: () => void;
  /** Set to what closing by a click outside does, for the field buttons to do the same. */
  closeRef?: React.MutableRefObject<(() => void) | undefined>;
}

/** Date and time of a point in the picked zone, as shown and edited. */
interface Point {
  date: string;
  time: string;
}

const pointOf = (ms: number, timeZone: TimeZone): Point => ({
  date: formatTime(ms, timeZone, 'YYYY-MM-DD'),
  time: formatTime(ms, timeZone, 'HH:mm:ss'),
});

// react-calendar works with local Dates; only their year, month and day matter here. A range
// ends at the end of its last day.
const toLocalDate = (date: string, endOfDay = false) =>
  endOfDay
    ? new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), 23, 59, 59, 999)
    : new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
const fromLocalDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthStart = (date: string) => new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, 1);

const LABELS: Record<RangeEnd, string> = { from: 'From', to: 'To' };

/**
 * Popup for an absolute range, in the selected zone. A day click sets the active end: the one whose
 * field opened the popup, until its From or To row is clicked. The rows also hold the ends' times.
 * Only the active end moves. Apply or a click outside applies; Cancel or Escape leaves the range as
 * it was.
 */
export function RangeCalendar({ from, to, timeZone, active, onActiveChange, top, onApply, onClose, closeRef }: Props) {
  const s = useStyles2(getStyles);
  const ref = useRef<HTMLDivElement>(null);
  const [initial] = useState(() => ({ from: pointOf(from, timeZone), to: pointOf(to, timeZone) }));
  const [draft, setDraft] = useState(initial);
  // The month of the end being picked.
  const [month] = useState(() => monthStart(initial[active].date));

  // An end left as it was keeps its exact time, milliseconds included.
  const resolve = (end: RangeEnd) => {
    const point = draft[end];
    if (point.date === initial[end].date && point.time === initial[end].time) {
      return end === 'from' ? from : to;
    }
    return parseTimeInput(`${point.date} ${point.time}`, timeZone);
  };
  const range = { from: resolve('from'), to: resolve('to') };
  // Days come from the calendar and times from the pickers, so both ends always read; a From after
  // To is applied too, and the fields below say what is wrong with it.
  const picked = range.from !== undefined && range.to !== undefined;
  const apply = () => picked && onApply({ from: range.from!, to: range.to! });
  // From at or after To: there is no range to shade, and the end not being picked is the one off.
  const reversed = picked && range.from! >= range.to!;
  const other: RangeEnd = active === 'from' ? 'to' : 'from';

  // Clicking away keeps what was picked, the way leaving a field keeps what was typed.
  const applyAndClose = () => (picked && (range.from !== from || range.to !== to) ? apply() : onClose());
  // Listeners are added once; they call the latest version, with the latest picks.
  const latestClose = useRef(applyAndClose);
  useLayoutEffect(() => {
    latestClose.current = applyAndClose;
  });
  useEffect(() => {
    if (!closeRef) {
      return;
    }
    closeRef.current = () => latestClose.current();
    return () => {
      closeRef.current = undefined;
    };
  }, [closeRef]);

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Element;
      // The fields' calendar buttons open and close the popup themselves.
      if (!ref.current?.contains(target) && !target.closest(`${TIME_PANEL}, [data-range-calendar-trigger]`)) {
        latestClose.current();
      }
    };
    // Escape in an open time list closes just the list.
    const onKey = (e: KeyboardEvent) =>
      e.key === 'Escape' && !document.querySelector(`${TIME_PANEL}:not(.rc-time-picker-panel-hidden)`) && onClose();
    document.addEventListener('mousedown', onPointer, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const pickDay = (day: Date) => {
    const date = fromLocalDate(day);
    // Only the active end moves, even past the other one: that is then picked next.
    setDraft((d) => ({ ...d, [active]: { ...d[active], date } }));
  };
  const setTime = (end: RangeEnd, time: string) => setDraft((d) => ({ ...d, [end]: { ...d[end], time } }));

  return (
    <div ref={ref} className={s.popup} style={{ top }} role="dialog" aria-label={`Pick ${LABELS[active]}`}>
      <Calendar
        className={s.calendar}
        value={reversed ? null : [toLocalDate(draft.from.date), toLocalDate(draft.to.date, true)]}
        onClickDay={pickDay}
        defaultActiveStartDate={month}
        tileClassName={({ date, view }) => {
          if (view !== 'month') {
            return null;
          }
          const day = fromLocalDate(date);
          return (
            cx(
              day === draft[active].date && s.activeDay,
              // Without a range the ends keep their shapes, From opening and To closing, wherever they are.
              reversed && day === draft.from.date && s.startCap,
              reversed && day === draft.to.date && s.endCap,
              reversed && day === draft[other].date && day !== draft[active].date && s.offEnd
            ) || null
          );
        }}
        calendarType="iso8601"
        locale="en"
        formatShortWeekday={(_, date) => WEEKDAYS[date.getDay()]}
        minDetail="year"
        next2Label={null}
        prev2Label={null}
        nextLabel={<Icon name="angle-right" />}
        prevLabel={<Icon name="angle-left" />}
        nextAriaLabel="Next month"
        prevAriaLabel="Previous month"
      />
      <div className={s.ends}>
        {(['from', 'to'] as const).map((end) => (
          // Anything in the row, its time included, makes its end the active one.
          <div key={end} className={cx(s.end, end === active && s.activeEnd)} onMouseDown={() => onActiveChange(end)}>
            <button
              type="button"
              className={s.endLabel}
              aria-pressed={end === active}
              title={`A day click sets ${LABELS[end]}`}
              onClick={() => onActiveChange(end)}
            >
              {LABELS[end]}
            </button>
            {reversed && end === other ? (
              <span className={cx(s.date, s.offDate)} title="From is after To">
                {draft[end].date}
              </span>
            ) : (
              <span className={s.date}>{draft[end].date}</span>
            )}
            <TimeOfDayPicker
              showSeconds
              value={dateTime(`2000-01-01 ${draft[end].time}`, 'YYYY-MM-DD HH:mm:ss')}
              onChange={(value) => setTime(end, value.format('HH:mm:ss'))}
            />
          </div>
        ))}
      </div>
      <div className={s.footer}>
        <span className={s.note}>Times in {zoneLabel(range.from ?? from, timeZone)}</span>
        <Button size="sm" variant="secondary" fill="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={!picked} onClick={apply}>
          Apply
        </Button>
      </div>
    </div>
  );
}

const TILE = 32;

const getStyles = (theme: GrafanaTheme2) => {
  const ends = '.react-calendar__tile--rangeStart, .react-calendar__tile--rangeEnd';
  return {
    popup: css({
      position: 'absolute',
      right: 0,
      zIndex: theme.zIndex.dropdown,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.5),
      padding: theme.spacing(1.5),
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.primary,
      boxShadow: theme.shadows.z3,
    }),
    calendar: css({
      width: TILE * 7,
      alignSelf: 'center',
      '.react-calendar__navigation': { display: 'flex', alignItems: 'center', marginBottom: theme.spacing(0.5) },
      '.react-calendar__navigation button': {
        minWidth: TILE,
        height: TILE,
        border: 0,
        borderRadius: theme.shape.radius.default,
        background: 'transparent',
        color: theme.colors.text.primary,
        cursor: 'pointer',
        '&:hover:enabled': { background: theme.colors.action.hover },
        '&:disabled': { color: theme.colors.text.disabled, cursor: 'default' },
      },
      '.react-calendar__navigation__label': { fontWeight: theme.typography.fontWeightMedium },
      '.react-calendar__month-view__weekdays': {
        textAlign: 'center',
        color: theme.colors.text.secondary,
        fontSize: theme.typography.bodySmall.fontSize,
        abbr: { textDecoration: 'none', cursor: 'default' },
        paddingBottom: theme.spacing(0.5),
      },
      '.react-calendar__tile': {
        height: TILE,
        padding: 0,
        border: 0,
        background: 'transparent',
        color: theme.colors.text.primary,
        fontVariantNumeric: 'tabular-nums',
        cursor: 'pointer',
        '&:hover': { background: theme.colors.action.hover },
      },
      '.react-calendar__year-view .react-calendar__tile': { height: TILE * 1.5 },
      '.react-calendar__month-view__days__day--neighboringMonth': { color: theme.colors.text.disabled },
      '.react-calendar__tile--now': { fontWeight: theme.typography.fontWeightBold, textDecoration: 'underline' },
      // Days inside the range.
      '.react-calendar__tile--range, .react-calendar__tile--hasActive': {
        background: theme.colors.primary.transparent,
      },
      // Its ends, outlined; the one being picked is filled (activeDay).
      [ends]: {
        boxShadow: `inset 0 0 0 2px ${theme.colors.primary.main}`,
        fontWeight: theme.typography.fontWeightMedium,
      },
      '.react-calendar__tile--rangeStart': { borderTopLeftRadius: TILE / 2, borderBottomLeftRadius: TILE / 2 },
      '.react-calendar__tile--rangeEnd': { borderTopRightRadius: TILE / 2, borderBottomRightRadius: TILE / 2 },
    }),
    // The other end, when it no longer makes a range with the one being picked.
    startCap: css({ borderTopLeftRadius: TILE / 2, borderBottomLeftRadius: TILE / 2 }),
    endCap: css({ borderTopRightRadius: TILE / 2, borderBottomRightRadius: TILE / 2 }),
    // The other end, when it no longer makes a range with the one being picked: a faint red line.
    offEnd: css({ boxShadow: `inset 0 0 0 1px ${colorManipulator.alpha(theme.colors.error.main, 0.6)}` }),
    activeDay: css({
      background: `${theme.colors.primary.main} !important`,
      color: `${theme.colors.primary.contrastText} !important`,
    }),
    ends: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(0.5) }),
    end: css({
      display: 'grid',
      gridTemplateColumns: '40px auto 1fr',
      alignItems: 'center',
      gap: theme.spacing(1),
      padding: theme.spacing(0.5, 1),
      borderLeft: '2px solid transparent',
      borderRadius: theme.shape.radius.default,
      cursor: 'pointer',
      '&:hover': { background: theme.colors.action.hover },
    }),
    activeEnd: css({
      borderLeftColor: theme.colors.primary.main,
      background: `${theme.colors.primary.transparent} !important`,
    }),
    endLabel: css({
      padding: 0,
      border: 0,
      background: 'transparent',
      color: theme.colors.text.secondary,
      textAlign: 'left',
      cursor: 'pointer',
      '&[aria-pressed=true]': { color: theme.colors.text.primary, fontWeight: theme.typography.fontWeightMedium },
    }),
    date: css({ fontVariantNumeric: 'tabular-nums' }),
    offDate: css({ color: colorManipulator.alpha(theme.colors.error.text, 0.75) }),
    footer: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1) }),
    note: css({ flex: 1, color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize }),
  };
};
