import React, { useLayoutEffect, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { AppEvents, GrafanaTheme2 } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import {
  Button,
  CodeEditor,
  CodeEditorSuggestionItem,
  CodeEditorSuggestionItemKind,
  Dropdown,
  Field,
  FilterInput,
  Icon,
  IconButton,
  Input,
  Menu,
  Modal,
  Toggletip,
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

const SAVE_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘S' : 'Ctrl+S';

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
  // Which dialog is open: save under a new name, or rename the current saved query.
  const [dialog, setDialog] = useState<'saveAs' | 'rename'>();
  const [name, setName] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [search, setSearch] = useState('');

  const current = savedQueries.find((q) => q.name === savedQueryName);
  const modified = current !== undefined && current.query !== query;

  const openDialog = (kind: 'saveAs' | 'rename') => {
    setName(kind === 'rename' ? (savedQueryName ?? '') : '');
    setDialog(kind);
  };

  // Saves in place when the tab holds a saved query, otherwise asks for a name.
  const save = () => {
    if (current) {
      onSave({ name: current.name, query });
      getAppEvents().publish({ type: AppEvents.alertSuccess.name, payload: [`Saved "${current.name}"`] });
    } else {
      openDialog('saveAs');
    }
  };

  // Monaco keeps the callbacks it was mounted with, so read the latest values through refs.
  const onChangeRef = useRef((value: string) => onChange(value, savedQueryName));
  const runRef = useRef(onRun);
  const saveRef = useRef(save);
  const fieldsRef = useRef(fields);
  useLayoutEffect(() => {
    onChangeRef.current = (value: string) => onChange(value, savedQueryName);
    runRef.current = onRun;
    saveRef.current = save;
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

  const confirmDialog = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    if (dialog === 'rename' && current) {
      onSave({ name: trimmed, query: current.query });
      if (trimmed !== current.name) {
        onDelete(current.name);
      }
    } else {
      onSave({ name: trimmed, query });
    }
    onChange(query, trimmed);
    setDialog(undefined);
  };

  const remove = (target: string) => {
    onDelete(target);
    if (target === savedQueryName) {
      onChange(query, undefined);
    }
  };

  const needle = search.trim().toLowerCase();
  const shown = needle
    ? savedQueries.filter((q) => q.name.toLowerCase().includes(needle) || q.query.toLowerCase().includes(needle))
    : savedQueries;

  const savedList = (
    <div className={s.list}>
      <FilterInput placeholder="Search saved queries" value={search} onChange={setSearch} autoFocus />
      <ul className={s.items}>
        {shown.map((q) => (
          <li key={q.name} className={cx(s.item, q.name === savedQueryName && s.itemActive)}>
            <button
              type="button"
              className={s.itemButton}
              onClick={() => {
                onChange(q.query, q.name);
                setListOpen(false);
              }}
            >
              <span className={s.itemName}>{q.name}</span>
              <span className={s.itemQuery}>{q.query.replace(/\s+/g, ' ')}</span>
            </button>
            <IconButton name="trash-alt" size="sm" tooltip="Delete saved query" onClick={() => remove(q.name)} />
          </li>
        ))}
        {shown.length === 0 && (
          <li className={s.empty}>
            {savedQueries.length === 0 ? `No saved queries yet. Save one with ${SAVE_SHORTCUT}.` : 'Nothing found'}
          </li>
        )}
      </ul>
    </div>
  );

  const actions = (
    <Menu>
      <Menu.Item label={current ? 'Save' : 'Save…'} icon="save" shortcut={SAVE_SHORTCUT} onClick={save} />
      <Menu.Item label="Save as…" icon="copy" onClick={() => openDialog('saveAs')} />
      {current && <Menu.Item label="Rename…" icon="edit" onClick={() => openDialog('rename')} />}
      {current && <Menu.Item label="Delete" icon="trash-alt" destructive onClick={() => remove(current.name)} />}
      {current && <Menu.Divider />}
      {current && <Menu.Item label="Detach from saved query" icon="times" onClick={() => onChange(query, undefined)} />}
    </Menu>
  );

  return (
    <section className={s.frame}>
      <div className={s.bar}>
        <Toggletip
          placement="bottom-start"
          fitContent
          closeButton={false}
          show={listOpen}
          onOpen={() => setListOpen(true)}
          onClose={() => setListOpen(false)}
          content={savedList}
        >
          <button type="button" className={s.picker} title="Saved queries">
            <Icon name="file-alt" />
            <span className={cx(s.pickerName, !current && s.untitled)}>{current?.name ?? 'Untitled query'}</span>
            {modified && <span className={s.dot} title="Unsaved changes" />}
            <Icon name="angle-down" />
          </button>
        </Toggletip>
        <div className={s.barActions}>
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
              <IconButton name="link" size="md" tooltip="Copy link to this query" />
            </Dropdown>
          ) : (
            <IconButton name="link" size="md" tooltip="Copy link to this query" onClick={() => onCopyLink(false)} />
          )}
          <Dropdown placement="bottom-end" overlay={actions}>
            <IconButton name="ellipsis-h" size="md" tooltip="Save, rename, delete" />
          </Dropdown>
        </div>
      </div>
      <CodeEditor
        language={LANGUAGE_ID}
        value={query}
        height="100%"
        showLineNumbers
        showMiniMap={false}
        containerStyles={s.editor}
        monacoOptions={{ wordWrap: 'on', scrollBeyondLastLine: false, fontSize: 13, renderLineHighlight: 'none' }}
        getSuggestions={getSuggestions}
        onBeforeEditorMount={registerLogsInsights}
        onEditorDidMount={(editor, monaco) => {
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
          editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()));
        }}
      />
      <Modal
        title={dialog === 'rename' ? 'Rename saved query' : 'Save query'}
        isOpen={dialog !== undefined}
        onDismiss={() => setDialog(undefined)}
      >
        <Field label="Name" description="Saving under an existing name overwrites it">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && confirmDialog()}
          />
        </Field>
        <Modal.ButtonRow>
          <Button variant="secondary" fill="outline" onClick={() => setDialog(undefined)}>
            Cancel
          </Button>
          <Button onClick={confirmDialog} disabled={!name.trim()}>
            {dialog === 'rename' ? 'Rename' : 'Save'}
          </Button>
        </Modal.ButtonRow>
      </Modal>
    </section>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  // Monaco has no border of its own; the frame makes the editor and its bar read as one text field.
  // It fills the row, which is at least as tall as the time range panel next to it.
  frame: css({
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    border: `1px solid ${theme.components.input.borderColor}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
    '&:hover': { borderColor: theme.components.input.borderHover },
    '&:focus-within': {
      borderColor: theme.colors.primary.border,
      boxShadow: `0 0 0 1px ${theme.colors.primary.border}`,
    },
  }),
  // Above the editor, whose layers would otherwise cover the saved queries popup.
  bar: css({
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    height: theme.spacing(4),
    padding: theme.spacing(0, 0.5, 0, 0.5),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
  }),
  picker: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    minWidth: 0,
    height: theme.spacing(3),
    padding: theme.spacing(0, 1),
    border: 'none',
    borderRadius: theme.shape.radius.default,
    background: 'transparent',
    color: theme.colors.text.primary,
    cursor: 'pointer',
    '&:hover': { background: theme.colors.action.hover },
  }),
  pickerName: css({
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: theme.typography.fontWeightMedium,
  }),
  untitled: css({ color: theme.colors.text.secondary, fontWeight: theme.typography.fontWeightRegular }),
  dot: css({ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: theme.colors.warning.main }),
  barActions: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1), paddingRight: theme.spacing(0.5) }),
  editor: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    flex: 1,
    minHeight: 220,
    cursor: 'text',
    position: 'relative',
    zIndex: 0,
  }),
  list: css({ width: 420, display: 'flex', flexDirection: 'column', gap: theme.spacing(1) }),
  items: css({ listStyle: 'none', margin: 0, padding: 0, maxHeight: 320, overflowY: 'auto' }),
  item: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    paddingRight: theme.spacing(0.5),
    borderRadius: theme.shape.radius.default,
    '&:hover': { background: theme.colors.action.hover },
    '& > button:last-child': { visibility: 'hidden' },
    '&:hover > button:last-child': { visibility: 'visible' },
  }),
  itemActive: css({ background: theme.colors.action.selected }),
  itemButton: css({
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    padding: theme.spacing(0.5, 1),
    border: 'none',
    background: 'transparent',
    color: theme.colors.text.primary,
    textAlign: 'left',
    cursor: 'pointer',
  }),
  itemName: css({ fontWeight: theme.typography.fontWeightMedium }),
  itemQuery: css({
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  empty: css({ padding: theme.spacing(1), color: theme.colors.text.secondary }),
});
