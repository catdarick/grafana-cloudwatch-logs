import { STORAGE_KEY } from '../constants';
import { PersistedState } from '../types';

export function loadState(): PersistedState | undefined {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as PersistedState;
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) {
      return undefined;
    }
    return {
      tabs: parsed.tabs,
      activeTabId: parsed.activeTabId ?? parsed.tabs[0].id,
      favorites: parsed.favorites ?? [],
      savedQueries: parsed.savedQueries ?? [],
      timeZone: parsed.timeZone ?? 'utc',
    };
  } catch {
    return undefined;
  }
}

export function saveState(state: PersistedState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the workspace still works, it just won't survive a reload.
  }
}
