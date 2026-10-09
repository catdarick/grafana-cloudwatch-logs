import React, { useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { IconButton, useStyles2 } from '@grafana/ui';
import { copyWithToast } from '../../utils/clipboard';

interface Props {
  value: unknown;
  /** Adds `filter path = value` (or `!=`) to the query and runs it. */
  onFilter: (path: string, value: unknown, negate: boolean) => void;
}

const OPEN_DEPTH = 2;

/** Collapsible, highlighted JSON with filter and copy actions on every value. */
export function JsonTree({ value, onFilter }: Props) {
  const s = useStyles2(getStyles);
  if (!isContainer(value)) {
    return <Leaf name="" path="" value={value} onFilter={onFilter} />;
  }
  return (
    <div className={s.tree}>
      {entries(value).map(([key, child]) => (
        <Node key={key} name={key} path={key} value={child} depth={0} onFilter={onFilter} />
      ))}
    </div>
  );
}

interface NodeProps {
  name: string;
  path: string;
  value: unknown;
  depth: number;
  onFilter: Props['onFilter'];
}

function Node({ name, path, value, depth, onFilter }: NodeProps) {
  const s = useStyles2(getStyles);
  const [open, setOpen] = useState(depth < OPEN_DEPTH);
  if (!isContainer(value)) {
    return <Leaf name={name} path={path} value={value} onFilter={onFilter} />;
  }
  const children = entries(value);
  const brackets = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return (
    <div>
      <div className={cx(s.line, s.branch)} onClick={() => setOpen(!open)}>
        <span className={s.caret}>{open ? '▾' : '▸'}</span>
        <span className={s.key}>{name}</span>
        <span className={s.punct}>
          {brackets[0]}
          {!open && ` ${children.length} ${Array.isArray(value) ? 'items' : 'keys'} ${brackets[1]}`}
        </span>
      </div>
      {open && (
        <div className={s.children}>
          {children.map(([key, child]) => (
            <Node
              key={key}
              name={key}
              path={path ? `${path}.${key}` : key}
              value={child}
              depth={depth + 1}
              onFilter={onFilter}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Leaf({ name, path, value, onFilter }: Omit<NodeProps, 'depth'>) {
  const s = useStyles2(getStyles);
  const text = value === null ? 'null' : typeof value === 'string' ? JSON.stringify(value) : String(value);
  const kind = value === null ? 'null' : typeof value;
  return (
    <div className={cx(s.line, s.leaf)}>
      <span className={s.caret} />
      {name && <span className={s.key}>{name}</span>}
      <span className={cx(s.value, s.kinds[kind as keyof typeof s.kinds])}>{text}</span>
      {path && (
        <span className={s.actions}>
          <IconButton
            name="search-plus"
            size="sm"
            tooltip={`Add filter ${path} = value to the query and run`}
            onClick={() => onFilter(path, value, false)}
          />
          <IconButton
            name="search-minus"
            size="sm"
            tooltip={`Add filter ${path} != value to the query and run`}
            onClick={() => onFilter(path, value, true)}
          />
          <IconButton
            name="copy"
            size="sm"
            tooltip="Copy value"
            onClick={() => copyWithToast(typeof value === 'string' ? value : text)}
          />
        </span>
      )}
    </div>
  );
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === 'object' && value !== null;
}

function entries(value: Record<string, unknown> | unknown[]): Array<[string, unknown]> {
  return Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value);
}

const getStyles = (theme: GrafanaTheme2) => ({
  tree: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.6,
  }),
  line: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    padding: theme.spacing(0, 0.5),
    borderRadius: theme.shape.radius.default,
    '&:hover': { background: theme.colors.action.hover },
  }),
  branch: css({ cursor: 'pointer' }),
  leaf: css({ '&:hover > span:last-child': { visibility: 'visible' } }),
  caret: css({ width: 10, flexShrink: 0, color: theme.colors.text.secondary }),
  key: css({ color: theme.colors.text.secondary, flexShrink: 0, '&::after': { content: '":"' } }),
  punct: css({ color: theme.colors.text.secondary }),
  value: css({ whiteSpace: 'pre-wrap', wordBreak: 'break-word', minWidth: 0 }),
  kinds: {
    string: css({ color: theme.isDark ? '#9cdcfe' : '#0451a5' }),
    number: css({ color: theme.isDark ? '#b5cea8' : '#098658' }),
    boolean: css({ color: theme.isDark ? '#569cd6' : '#0000ff' }),
    null: css({ color: theme.colors.text.disabled }),
  },
  actions: css({
    display: 'inline-flex',
    gap: theme.spacing(0.5),
    marginLeft: 'auto',
    flexShrink: 0,
    visibility: 'hidden',
  }),
  children: css({
    marginLeft: theme.spacing(1),
    paddingLeft: theme.spacing(1),
    borderLeft: `1px solid ${theme.colors.border.weak}`,
  }),
});
