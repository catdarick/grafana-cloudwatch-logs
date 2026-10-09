import React, { useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Checkbox, Modal, RadioButtonGroup, useStyles2 } from '@grafana/ui';

export interface ExportChoice {
  rows: 'shown' | 'all';
  fields: string[];
  /** Adds @message, @log and @logStream. */
  raw: boolean;
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

type ColumnMode = 'visible' | 'all' | 'custom';

/**
 * Two steps: which rows (only asked when filters, search or zoom hide some), then which columns.
 * Mount it fresh for each export so it starts from the first step.
 */
export function ExportDialog({ shownCount, totalCount, allFields, visibleFields, onExport, onDismiss }: Props) {
  const s = useStyles2(getStyles);
  const askRows = shownCount !== totalCount;
  const [step, setStep] = useState<'rows' | 'columns'>(askRows ? 'rows' : 'columns');
  const [rows, setRows] = useState<'shown' | 'all'>('all');
  const [mode, setMode] = useState<ColumnMode>(visibleFields.length === allFields.length ? 'all' : 'visible');
  const [custom, setCustom] = useState<Set<string>>(new Set(visibleFields));
  const [raw, setRaw] = useState(false);

  const fields =
    mode === 'visible' ? visibleFields : mode === 'all' ? allFields : allFields.filter((f) => custom.has(f));
  const rowCount = rows === 'shown' ? shownCount : totalCount;

  const toggle = (field: string) => {
    const next = new Set(custom);
    next.has(field) ? next.delete(field) : next.add(field);
    setCustom(next);
  };

  const pickRows = (choice: 'shown' | 'all') => {
    setRows(choice);
    setStep('columns');
  };

  return (
    <Modal title="Export CSV" isOpen onDismiss={onDismiss}>
      {step === 'rows' ? (
        <div className={s.options}>
          <button type="button" className={s.option} onClick={() => pickRows('shown')}>
            <span className={s.optionTitle}>Shown rows ({shownCount.toLocaleString('en-US')})</span>
            <span className={s.optionText}>As on screen: after filters, search and zoom</span>
          </button>
          <button type="button" className={s.option} onClick={() => pickRows('all')}>
            <span className={s.optionTitle}>All loaded rows ({totalCount.toLocaleString('en-US')})</span>
            <span className={s.optionText}>Everything the query returned</span>
          </button>
        </div>
      ) : (
        <div className={s.columns}>
          <RadioButtonGroup<ColumnMode>
            fullWidth
            value={mode}
            onChange={setMode}
            options={[
              { label: `Visible columns (${visibleFields.length})`, value: 'visible' },
              { label: `All fields (${allFields.length})`, value: 'all' },
              { label: 'Choose…', value: 'custom' },
            ]}
          />
          {mode === 'custom' && (
            <div className={s.custom}>
              <div className={s.customBar}>
                <Button size="sm" variant="secondary" fill="text" onClick={() => setCustom(new Set(allFields))}>
                  Select all
                </Button>
                <Button size="sm" variant="secondary" fill="text" onClick={() => setCustom(new Set())}>
                  Clear
                </Button>
              </div>
              <div className={s.list}>
                {allFields.map((f) => (
                  <Checkbox key={f} className={s.item} label={f} value={custom.has(f)} onChange={() => toggle(f)} />
                ))}
              </div>
            </div>
          )}
          <Checkbox
            className={s.raw}
            label="Include the raw log"
            description="Adds @message (the whole log event), @log and @logStream"
            value={raw}
            onChange={(e) => setRaw(e.currentTarget.checked)}
          />
          <div className={cx(s.summary)}>
            {rowCount.toLocaleString('en-US')} rows × {fields.length + (raw ? 3 : 0)} columns
          </div>
        </div>
      )}
      <Modal.ButtonRow
        leftItems={
          step === 'columns' && askRows ? (
            <Button variant="secondary" fill="text" icon="arrow-left" onClick={() => setStep('rows')}>
              Back
            </Button>
          ) : undefined
        }
      >
        <Button variant="secondary" fill="outline" onClick={onDismiss}>
          Cancel
        </Button>
        {step === 'columns' && (
          <Button
            icon="download-alt"
            disabled={fields.length === 0 && !raw}
            onClick={() => onExport({ rows, fields, raw })}
          >
            Export
          </Button>
        )}
      </Modal.ButtonRow>
    </Modal>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  options: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(1) }),
  option: css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: theme.spacing(0.5),
    padding: theme.spacing(1.5, 2),
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
    color: theme.colors.text.primary,
    textAlign: 'left',
    cursor: 'pointer',
    '&:hover': { borderColor: theme.colors.primary.border, background: theme.colors.action.hover },
  }),
  optionTitle: css({ fontWeight: theme.typography.fontWeightMedium }),
  optionText: css({ color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize }),
  columns: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(2) }),
  custom: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    padding: theme.spacing(1),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
  }),
  customBar: css({ display: 'flex', gap: theme.spacing(1) }),
  list: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: theme.spacing(0.5, 2),
    maxHeight: 260,
    overflowY: 'auto',
  }),
  item: css({
    minWidth: 0,
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    '& > span:last-child': { maxWidth: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  }),
  raw: css({ gridTemplateColumns: 'auto 1fr', justifyItems: 'start' }),
  summary: css({ color: theme.colors.text.secondary }),
});
