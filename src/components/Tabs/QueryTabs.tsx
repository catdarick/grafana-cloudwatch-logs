import React, { useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { IconButton, Spinner, useStyles2 } from '@grafana/ui';
import { QueryResult, QueryTab } from '../../types';

interface Props {
  tabs: QueryTab[];
  activeTabId: string;
  results: Record<string, QueryResult | undefined>;
  running: Record<string, boolean>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, title: string) => void;
}

/** Each tab is a full workspace: its own log groups, query, time range and results. */
export function QueryTabs({ tabs, activeTabId, results, running, onSelect, onClose, onAdd, onRename }: Props) {
  const s = useStyles2(getStyles);
  const [editing, setEditing] = useState<string>();

  return (
    <div className={s.bar} role="tablist">
      {tabs.map((tab) => {
        const result = results[tab.id];
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            className={cx(s.tab, active && s.active)}
            onClick={() => onSelect(tab.id)}
            onDoubleClick={() => setEditing(tab.id)}
            title="Double-click to rename"
          >
            <div className={s.text}>
              {editing === tab.id ? (
                <input
                  autoFocus
                  className={s.rename}
                  defaultValue={tab.title}
                  onBlur={(e) => {
                    onRename(tab.id, e.currentTarget.value.trim() || tab.title);
                    setEditing(undefined);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Escape') {
                      e.currentTarget.blur();
                    }
                  }}
                />
              ) : (
                <span className={s.title}>{tab.title}</span>
              )}
              <span className={s.sub}>
                {running[tab.id] ? (
                  <>
                    <Spinner inline size="xs" /> running
                  </>
                ) : result ? (
                  result.error ? (
                    'error'
                  ) : (
                    `${result.rows.length} rows · ${new Date(result.ranAt).toLocaleTimeString()}`
                  )
                ) : (
                  'not run'
                )}
              </span>
            </div>
            <IconButton
              name="times"
              size="sm"
              aria-label={`Close ${tab.title}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
            />
          </div>
        );
      })}
      <IconButton name="plus" tooltip="New tab (copies the current one)" onClick={onAdd} className={s.add} />
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  bar: css({
    display: 'flex',
    alignItems: 'stretch',
    gap: theme.spacing(1),
    overflowX: 'auto',
    flex: 1,
    minWidth: 0,
  }),
  tab: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5, 1, 0.5, 1.5),
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
    cursor: 'pointer',
    flexShrink: 0,
  }),
  active: css({
    background: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    '& button': { color: theme.colors.primary.contrastText },
  }),
  text: css({ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }),
  title: css({ fontWeight: theme.typography.fontWeightMedium }),
  sub: css({ fontSize: theme.typography.bodySmall.fontSize, opacity: 0.8 }),
  rename: css({ width: 140, color: theme.colors.text.primary, background: theme.colors.background.primary }),
  add: css({ alignSelf: 'center' }),
});
