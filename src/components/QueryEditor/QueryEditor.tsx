import React, { useLayoutEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import {
  Button,
  CodeEditor,
  CodeEditorSuggestionItem,
  CodeEditorSuggestionItemKind,
  Dropdown,
  Field,
  IconButton,
  Input,
  Menu,
  Modal,
  Select,
  useStyles2,
} from '@grafana/ui';
import {
  COMMANDS,
  FUNCTIONS,
  KEYWORDS,
  LANGUAGE_ID,
  SYSTEM_FIELDS,
  registerLogsInsights,
} from '../../language/logsInsights';
import { SavedQuery } from '../../types';

interface Props {
  query: string;
  /** Field names offered by autocomplete (discovered from log groups and past results). */
  fields: string[];
  savedQueryName?: string;
  savedQueries: SavedQuery[];
  onChange: (query: string, savedQueryName?: string) => void;
  onRun: () => void;
  onSave: (query: SavedQuery) => void;
  onDelete: (name: string) => void;
  /** Relative ranges get a second option that pins the time, so the link shows the same logs later. */
  relativeTime: boolean;
  onCopyLink: (fixedTime: boolean) => void;
}

export function QueryEditor({
  query,
  fields,
  savedQueryName,
  savedQueries,
  onChange,
  onRun,
  onSave,
  onDelete,
  relativeTime,
  onCopyLink,
}: Props) {
  const s = useStyles2(getStyles);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');

  // Monaco keeps the callbacks it was mounted with, so read the latest values through refs.
  const onChangeRef = useRef((value: string) => onChange(value, savedQueryName));
  const runRef = useRef(onRun);
  const fieldsRef = useRef(fields);
  useLayoutEffect(() => {
    onChangeRef.current = (value: string) => onChange(value, savedQueryName);
    runRef.current = onRun;
    fieldsRef.current = fields;
  });

  const getSuggestions = (): CodeEditorSuggestionItem[] => [
    ...COMMANDS.map((label) => ({ label, kind: CodeEditorSuggestionItemKind.Method, detail: 'command' })),
    ...FUNCTIONS.map((label) => ({ label, kind: CodeEditorSuggestionItemKind.Method, detail: 'function' })),
    ...KEYWORDS.map((label) => ({ label, kind: CodeEditorSuggestionItemKind.Text, detail: 'keyword' })),
    ...Array.from(new Set([...SYSTEM_FIELDS, ...fieldsRef.current])).map((label) => ({
      label,
      kind: CodeEditorSuggestionItemKind.Field,
      detail: 'field',
    })),
  ];

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
          {relativeTime ? (
            <Dropdown
              placement="bottom-end"
              overlay={
                <Menu>
                  <Menu.Item
                    label="Copy link"
                    description="Keeps the relative range: opens the latest logs"
                    icon="link"
                    onClick={() => onCopyLink(false)}
                  />
                  <Menu.Item
                    label="Copy link with fixed time"
                    description="Pins the range of the last run, or now if not run yet"
                    icon="clock-nine"
                    onClick={() => onCopyLink(true)}
                  />
                </Menu>
              }
            >
              <Button size="sm" variant="secondary" fill="text" icon="link">
                Copy link
              </Button>
            </Dropdown>
          ) : (
            <Button size="sm" variant="secondary" fill="text" icon="link" onClick={() => onCopyLink(false)}>
              Copy link
            </Button>
          )}
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
      <CodeEditor
        language={LANGUAGE_ID}
        value={query}
        height={220}
        showLineNumbers
        showMiniMap={false}
        containerStyles={s.editor}
        monacoOptions={{ wordWrap: 'on', scrollBeyondLastLine: false, fontSize: 13, renderLineHighlight: 'none' }}
        getSuggestions={getSuggestions}
        onBeforeEditorMount={registerLogsInsights}
        onEditorDidMount={(editor, monaco) => {
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
          editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()));
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
  // Monaco has no border of its own; frame it like a Grafana input so it reads as a text field.
  editor: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    minHeight: 200,
    border: `1px solid ${theme.components.input.borderColor}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
    cursor: 'text',
    '&:hover': { borderColor: theme.components.input.borderHover },
    '&:focus-within': {
      borderColor: theme.colors.primary.border,
      boxShadow: `0 0 0 1px ${theme.colors.primary.border}`,
    },
  }),
});
