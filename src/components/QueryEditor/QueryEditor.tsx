import React, { useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Button, Field, IconButton, Input, Modal, Select, TextArea, useStyles2 } from '@grafana/ui';
import { SavedQuery } from '../../types';

interface Props {
  query: string;
  savedQueryName?: string;
  savedQueries: SavedQuery[];
  onChange: (query: string, savedQueryName?: string) => void;
  onRun: () => void;
  onSave: (query: SavedQuery) => void;
  onDelete: (name: string) => void;
}

export function QueryEditor({ query, savedQueryName, savedQueries, onChange, onRun, onSave, onDelete }: Props) {
  const s = useStyles2(getStyles);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');

  const options: Array<SelectableValue<string>> = savedQueries.map((q) => ({ label: q.name, value: q.name }));
  const current = savedQueries.find((q) => q.name === savedQueryName);
  const modified = current !== undefined && current.query !== query;

  const openSave = () => {
    setName(savedQueryName ?? '');
    setSaveOpen(true);
  };

  const confirmSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    onSave({ name: trimmed, query });
    onChange(query, trimmed);
    setSaveOpen(false);
  };

  return (
    <section className={s.section}>
      <div className={s.header}>
        <h5 className={s.title}>Query editor</h5>
        <div className={s.saved}>
          <Select
            width={32}
            isClearable
            placeholder="Saved queries"
            options={options}
            value={savedQueryName ?? null}
            onChange={(v) => {
              const picked = savedQueries.find((q) => q.name === v?.value);
              onChange(picked ? picked.query : query, picked?.name);
            }}
          />
          <IconButton name="save" tooltip={modified ? 'Save changes' : 'Save query'} onClick={openSave} />
          {savedQueryName && (
            <IconButton
              name="trash-alt"
              tooltip="Delete saved query"
              onClick={() => {
                onDelete(savedQueryName);
                onChange(query, undefined);
              }}
            />
          )}
        </div>
      </div>
      <TextArea
        className={s.editor}
        value={query}
        spellCheck={false}
        rows={10}
        onChange={(e) => onChange(e.currentTarget.value, savedQueryName)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onRun();
          }
        }}
      />
      <Modal title="Save query" isOpen={saveOpen} onDismiss={() => setSaveOpen(false)}>
        <Field label="Name" description="Saving under an existing name overwrites it">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && confirmSave()}
          />
        </Field>
        <Modal.ButtonRow>
          <Button variant="secondary" fill="outline" onClick={() => setSaveOpen(false)}>
            Cancel
          </Button>
          <Button onClick={confirmSave} disabled={!name.trim()}>
            Save
          </Button>
        </Modal.ButtonRow>
      </Modal>
    </section>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  section: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(1), minWidth: 0 }),
  header: css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing(1) }),
  title: css({ margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }),
  saved: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(0.5) }),
  editor: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    minHeight: 200,
  }),
});
