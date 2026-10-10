import { useState } from 'react';
import { TableView } from '../types';

/**
 * How each tab's results table was left, kept for as long as the page is open. A view belongs to
 * the result it was made on: a new run of the tab starts with a fresh table.
 */
export function createTableViews() {
  const views = new Map<string, { ranAt: number; view: TableView }>();
  return {
    get(tabId: string, ranAt: number): TableView | undefined {
      const saved = views.get(tabId);
      return saved?.ranAt === ranAt ? saved.view : undefined;
    },
    save(tabId: string, ranAt: number, view: TableView) {
      views.set(tabId, { ranAt, view });
    },
    forget(tabId: string) {
      views.delete(tabId);
    },
  };
}

export function useTableViews() {
  return useState(createTableViews)[0];
}
