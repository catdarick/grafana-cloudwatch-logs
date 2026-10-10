import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryResult, TableView } from '../../types';
import { ResultsTable } from './ResultsTable';

beforeAll(() => {
  // jsdom has no ResizeObserver; the table only uses it for the width of expanded details.
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // jsdom lays nothing out; without a size the virtualized table renders no rows.
  jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400);
  jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
});

const result: QueryResult = {
  query: 'fields @timestamp, level, @message',
  ranAt: 1,
  durationMs: 100,
  from: 1_700_000_000_000,
  to: 1_700_000_060_000,
  fields: ['level', '@message'],
  timeFields: [],
  rows: [
    { level: 'info', '@message': 'started' },
    { level: 'error', '@message': 'boom' },
    { level: 'info', '@message': 'stopped' },
  ],
  details: [{ timestamp: 1_700_000_010_000 }, { timestamp: 1_700_000_020_000 }, { timestamp: 1_700_000_030_000 }],
  stats: {},
};

function renderTable(props: { initialView?: TableView; onSaveView?: (view: TableView) => void } = {}) {
  return render(
    <ResultsTable
      result={result}
      timeZone="utc"
      columns={{}}
      onColumnsChange={() => {}}
      onRunRange={() => {}}
      onAddQueryFilter={() => {}}
      exportName="Query 1"
      onFilterClauses={() => {}}
      {...props}
    />
  );
}

const searchBox = () => screen.getByPlaceholderText('Search loaded logs') as HTMLInputElement;
const hideBox = () => screen.getByLabelText('Hide non-matching') as HTMLInputElement;
const scrollArea = (container: HTMLElement) => container.querySelector('table')!.parentElement as HTMLDivElement;

describe('ResultsTable view', () => {
  it('hands back search, filters, open rows and scroll when it goes away', () => {
    const onSaveView = jest.fn();
    const { container, unmount } = renderTable({ onSaveView });

    fireEvent.change(searchBox(), { target: { value: 'o' } });
    fireEvent.click(hideBox());
    fireEvent.click(screen.getAllByRole('button', { name: 'Toggle row details' })[0]);
    // Keeps only the "info" rows.
    fireEvent.click(screen.getAllByLabelText('Show only this value')[0]);
    const scroll = scrollArea(container);
    Object.defineProperty(scroll, 'scrollTop', { value: 120, configurable: true });
    Object.defineProperty(scroll, 'scrollLeft', { value: 40, configurable: true });
    fireEvent.scroll(scroll);

    expect(onSaveView).not.toHaveBeenCalled();
    unmount();

    expect(onSaveView).toHaveBeenCalledTimes(1);
    const view: TableView = onSaveView.mock.calls[0][0];
    expect(view.search).toBe('o');
    expect(view.hideNonMatching).toBe(true);
    expect(view.filters).toEqual({ level: new Set(['info']) });
    expect(view.expanded).toEqual(new Set([0]));
    expect(view.scrollTop).toBe(120);
    expect(view.scrollLeft).toBe(40);
  });

  it('comes back as it was left', () => {
    const scrollTop = jest.spyOn(Element.prototype, 'scrollTop', 'set');
    const scrollLeft = jest.spyOn(Element.prototype, 'scrollLeft', 'set');
    renderTable({
      initialView: {
        filters: { level: new Set(['info']) },
        zoom: { from: 1_700_000_005_000, to: 1_700_000_035_000 },
        search: 'stop',
        hideNonMatching: true,
        current: 0,
        expanded: new Set([2]),
        unclamped: new Set(),
        scrollTop: 120,
        scrollLeft: 40,
      },
    });

    expect(searchBox().value).toBe('stop');
    expect(hideBox().checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Clear filter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toBeInTheDocument();
    expect(screen.getByText('1 of 3 rows')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle row details' })).toHaveAttribute('aria-expanded', 'true');
    expect(scrollTop).toHaveBeenCalledWith(120);
    expect(scrollLeft).toHaveBeenCalledWith(40);
    scrollTop.mockRestore();
    scrollLeft.mockRestore();
  });

  it('starts clean without a saved view', () => {
    renderTable();

    expect(searchBox().value).toBe('');
    expect(hideBox().checked).toBe(false);
    expect(screen.queryByRole('button', { name: /Clear/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset zoom' })).not.toBeInTheDocument();
    expect(screen.getByText('3 rows')).toBeInTheDocument();
  });
});
