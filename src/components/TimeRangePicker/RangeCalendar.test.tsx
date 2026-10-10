import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { RangeCalendar } from './RangeCalendar';

// 2026-10-09 21:58:08.123 → 2026-10-09 23:18:04 UTC
const from = Date.UTC(2026, 9, 9, 21, 58, 8, 123);
const to = Date.UTC(2026, 9, 9, 23, 18, 4);

function renderCalendar(timeZone = 'utc', start: 'from' | 'to' = 'from') {
  const onApply = jest.fn();
  const onClose = jest.fn();
  // The popup's parent keeps the active end; let it follow, the way TimeRangePicker does.
  function Harness() {
    const [active, setActive] = React.useState(start);
    return (
      <RangeCalendar
        from={from}
        to={to}
        timeZone={timeZone}
        active={active}
        onActiveChange={setActive}
        top={0}
        onApply={onApply}
        onClose={onClose}
      />
    );
  }
  render(<Harness />);
  return { onApply, onClose };
}

const day = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const apply = () => fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

describe('RangeCalendar', () => {
  it('opened from From, changes only From until To is chosen, keeping the times of day', () => {
    const { onApply } = renderCalendar();
    day('October 3, 2026');
    day('October 5, 2026');
    expect(screen.getByRole('button', { name: 'From' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'To' }));
    day('October 8, 2026');
    apply();
    expect(onApply).toHaveBeenCalledWith({
      from: Date.UTC(2026, 9, 5, 21, 58, 8),
      to: Date.UTC(2026, 9, 8, 23, 18, 4),
    });
  });

  it('opened from To, changes only To', () => {
    const { onApply } = renderCalendar('utc', 'to');
    day('October 12, 2026');
    apply();
    expect(onApply).toHaveBeenCalledWith({ from, to: Date.UTC(2026, 9, 12, 23, 18, 4) });
  });

  it('moves only the active end, even past the other one', () => {
    const { onApply } = renderCalendar();
    day('October 12, 2026');
    fireEvent.click(screen.getByRole('button', { name: 'To' }));
    day('October 14, 2026');
    apply();
    expect(onApply).toHaveBeenCalledWith({
      from: Date.UTC(2026, 9, 12, 21, 58, 8),
      to: Date.UTC(2026, 9, 14, 23, 18, 4),
    });
  });

  it('shades no range while From is after To, and marks To as off', () => {
    renderCalendar();
    expect(document.querySelectorAll('.react-calendar__tile--range')).not.toHaveLength(0);
    day('October 12, 2026');
    expect(document.querySelectorAll('.react-calendar__tile--range')).toHaveLength(0);
    expect(screen.getByTitle('From is after To')).toHaveTextContent('2026-10-09');
  });

  it('applies a From after To as well: the fields below show the error', () => {
    const { onApply } = renderCalendar();
    day('October 12, 2026');
    fireEvent.mouseDown(document.body);
    expect(onApply).toHaveBeenCalledWith({ from: Date.UTC(2026, 9, 12, 21, 58, 8), to });
  });

  it('switches the end a day sets from its row', () => {
    const { onApply } = renderCalendar('utc', 'to');
    fireEvent.click(screen.getByRole('button', { name: 'From' }));
    day('October 1, 2026');
    apply();
    expect(onApply).toHaveBeenCalledWith({ from: Date.UTC(2026, 9, 1, 21, 58, 8), to });
  });

  it('reads days and times in the selected zone', () => {
    // 21:58:08 UTC is 00:58:08 the next day in Moscow (UTC+3).
    const { onApply } = renderCalendar('Europe/Moscow');
    expect(screen.getAllByText('2026-10-10')).toHaveLength(2);
    day('October 5, 2026');
    fireEvent.click(screen.getByRole('button', { name: 'To' }));
    day('October 6, 2026');
    apply();
    expect(onApply).toHaveBeenCalledWith({
      from: Date.UTC(2026, 9, 4, 21, 58, 8),
      to: Date.UTC(2026, 9, 5, 23, 18, 4),
    });
  });

  it('leaves an untouched end exactly as it was', () => {
    const { onApply } = renderCalendar();
    apply();
    expect(onApply).toHaveBeenCalledWith({ from, to });
  });

  it('applies what was picked on a click outside', () => {
    const { onApply, onClose } = renderCalendar();
    day('October 5, 2026');
    fireEvent.mouseDown(document.body);
    expect(onApply).toHaveBeenCalledWith({ from: Date.UTC(2026, 9, 5, 21, 58, 8), to });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('just closes on a click outside when nothing changed', () => {
    const { onApply, onClose } = renderCalendar();
    day('October 9, 2026');
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('drops what was picked on Escape or Cancel', () => {
    const { onApply, onClose } = renderCalendar();
    day('October 5, 2026');
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onApply).not.toHaveBeenCalled();
  });
});
