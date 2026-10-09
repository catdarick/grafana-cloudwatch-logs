import React, { useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Checkbox, Modal, RadioButtonGroup, useStyles2 } from '@grafana/ui';

/** Parts of the raw log event that are not columns but can be exported. */
export const RAW_FIELDS = [
  { name: '@message', description: 'the whole log event' },
  { name: '@log', description: 'log group' },
  { name: '@logStream', description: 'log stream' },
];

export interface ExportChoice {
  rows: 'shown' | 'all';
  /** Table fields first, then the chosen raw fields. */
  fields: string[];
}

interface Props {
  shownCount: number;
  totalCount: number;
  /** All fields in table order. */
  allFields: string[];
  visibleFields: string[];
  onExport: (choice: ExportChoice) => void;
  onDismiss: () => void;
}

/** One screen: which rows (only when filters, search or zoom hide some), which columns, which raw parts. */
export function ExportDialog({ shownCount, totalCount, allFields, visibleFields, onExport, onDismiss }: Props) {
  const s = useStyles2(getStyles);
  const askRows = shownCount !== totalCount;
  const [rows, setRows] = useState<'shown' | 'all'>('shown');
  const [picked, setPicked] = useState<Set<string>>(new Set(visibleFields));
  // A raw part the query already returns as a column is the same value; offer it once.
  const raw = RAW_FIELDS.filter((r) => !allFields.includes(r.name));

  const toggle = (field: string) => {
    const next = new Set(picked);
    next.has(field) ? next.delete(field) : next.add(field);
    setPicked(next);
  };

  const fields = [...allFields, ...raw.map((r) => r.name)].filter((f) => picked.has(f));
  const rowCount = askRows && rows === 'shown' ? shownCount : totalCount;

  return (
    <Modal title="Export CSV" isOpen onDismiss={onDismiss}>
      <div className={s.body}>
        {askRows && (
          <div className={s.group}>
            <div className={s.groupTitle}>Rows</div>
            <RadioButtonGroup<'shown' | 'all'>
              value={rows}
              onChange={setRows}
              options={[
                {
                  label: `Shown (${shownCount.toLocaleString('en-US')})`,
                  value: 'shown',
                  description: 'As on screen: after filters, search and zoom',
                },
                {
                  label: `All loaded (${totalCount.toLocaleString('en-US')})`,
                  value: 'all',
                  description: 'Everything the query returned',
                },
              ]}
            />
          </div>
        )}
        <div className={s.group}>
          <div className={s.groupHeader}>
            <span className={s.groupTitle}>Columns</span>
            <Button size="sm" variant="secondary" fill="text" onClick={() => setPicked(new Set(visibleFields))}>
              Visible
            </Button>
            <Button
              size="sm"
              variant="secondary"
              fill="text"
              onClick={() => setPicked(new Set([...picked, ...allFields]))}
            >
              All
            </Button>
            <Button
              size="sm"
              variant="secondary"
              fill="text"
              onClick={() => setPicked(new Set([...picked].filter((f) => !allFields.includes(f))))}
            >
              None
            </Button>
          </div>
          <div className={s.list}>
            {allFields.map((f) => (
              <Checkbox key={f} className={s.item} label={f} value={picked.has(f)} onChange={() => toggle(f)} />
            ))}
          </div>
        </div>
        {raw.length > 0 && (
          <div className={s.group}>
            <span className={s.groupTitle}>Raw log</span>
            <div className={s.list}>
              {raw.map((r) => (
                <Checkbox
                  key={r.name}
                  className={s.item}
                  label={`${r.name} — ${r.description}`}
                  value={picked.has(r.name)}
                  onChange={() => toggle(r.name)}
                />
              ))}
            </div>
          </div>
        )}
        <div className={s.summary}>
          {rowCount.toLocaleString('en-US')} rows × {fields.length} columns
        </div>
      </div>
      <Modal.ButtonRow>
        <Button variant="secondary" fill="outline" onClick={onDismiss}>
          Cancel
        </Button>
        <Button
          icon="download-alt"
          disabled={fields.length === 0}
          onClick={() => onExport({ rows: askRows ? rows : 'all', fields })}
        >
          Export
        </Button>
      </Modal.ButtonRow>
    </Modal>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  body: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(2) }),
  group: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(1) }),
  groupHeader: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(0.5) }),
  groupTitle: css({
    marginRight: 'auto',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  }),
  list: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    maxHeight: 280,
    overflowY: 'auto',
    padding: theme.spacing(1),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
  }),
  item: css({
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    justifyItems: 'start',
    '& > span:last-child': { maxWidth: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  }),
  summary: css({ color: theme.colors.text.secondary }),
});
