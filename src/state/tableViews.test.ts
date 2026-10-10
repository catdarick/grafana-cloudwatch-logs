import { TableView } from '../types';
import { createTableViews } from './tableViews';

const view = (search: string): TableView => ({
  filters: {},
  search,
  hideNonMatching: false,
  current: 0,
  expanded: new Set(),
  unclamped: new Set(),
  scrollTop: 0,
  scrollLeft: 0,
});

describe('createTableViews', () => {
  it('keeps a view per tab', () => {
    const views = createTableViews();
    views.save('a', 1, view('first'));
    views.save('b', 2, view('second'));

    expect(views.get('a', 1)?.search).toBe('first');
    expect(views.get('b', 2)?.search).toBe('second');
  });

  it('drops the view once the tab has a new result', () => {
    const views = createTableViews();
    views.save('a', 1, view('old'));

    expect(views.get('a', 2)).toBeUndefined();
  });

  it('forgets a closed tab', () => {
    const views = createTableViews();
    views.save('a', 1, view('x'));
    views.forget('a');

    expect(views.get('a', 1)).toBeUndefined();
  });
});
