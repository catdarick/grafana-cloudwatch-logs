import React, { useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, Checkbox, Icon, IconButton, Input, Toggletip, useStyles2 } from '@grafana/ui';
import { fetchLogGroups } from '../../api/cloudwatch';
import { sameGroup } from '../../state/useWorkspace';
import { LogGroupRef } from '../../types';

interface Props {
  datasourceUid?: string;
  defaultRegion: string;
  selected: LogGroupRef[];
  favorites: LogGroupRef[];
  onSelectedChange: (groups: LogGroupRef[]) => void;
  onToggleFavorite: (group: LogGroupRef) => void;
}

export function LogGroups({
  datasourceUid,
  defaultRegion,
  selected,
  favorites,
  onSelectedChange,
  onToggleFavorite,
}: Props) {
  const s = useStyles2(getStyles);
  const [region, setRegion] = useState(defaultRegion);
  const [prefix, setPrefix] = useState('');
  const [found, setFound] = useState<LogGroupRef[]>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const isSelected = (g: LogGroupRef) => selected.some((x) => sameGroup(x, g));
  const isFavorite = (g: LogGroupRef) => favorites.some((x) => sameGroup(x, g));
  const toggle = (g: LogGroupRef) =>
    onSelectedChange(isSelected(g) ? selected.filter((x) => !sameGroup(x, g)) : [...selected, g]);

  const search = async () => {
    if (!datasourceUid) {
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      setFound(await fetchLogGroups(datasourceUid, region, prefix));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const item = (g: LogGroupRef) => (
    <li key={`${g.region}:${g.arn ?? g.name}`} className={s.listItem}>
      <IconButton
        name={isFavorite(g) ? 'favorite' : 'star'}
        className={cx(isFavorite(g) && s.favorite)}
        tooltip={isFavorite(g) ? 'Remove from favorites' : 'Add to favorites'}
        onClick={() => onToggleFavorite(g)}
      />
      <Checkbox className={s.checkbox} value={isSelected(g)} onChange={() => toggle(g)} label={g.name} />
      <span className={s.region}>{g.region}</span>
    </li>
  );

  const picker = (
    <div className={s.picker}>
      {favorites.length > 0 && (
        <div className={s.group}>
          <div className={s.groupTitle}>Favorites</div>
          <ul className={s.list}>{favorites.map(item)}</ul>
        </div>
      )}
      <div className={s.group}>
        <div className={s.groupTitle}>Browse</div>
        <div className={s.searchRow}>
          <Input width={22} value={region} onChange={(e) => setRegion(e.currentTarget.value)} prefix="Region" />
          <Input
            autoFocus
            value={prefix}
            placeholder="Name prefix, e.g. /k8s/"
            onChange={(e) => setPrefix(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
          />
          <Button onClick={search} disabled={!datasourceUid || loading} icon={loading ? 'spinner' : 'search'}>
            Search
          </Button>
        </div>
        {error && (
          <Alert severity="error" title="Could not list log groups">
            {error}
          </Alert>
        )}
        {found && (
          <ul className={cx(s.list, s.results)}>
            {found.map(item)}
            {found.length === 0 && <li className={s.empty}>No log groups with this prefix</li>}
          </ul>
        )}
      </div>
    </div>
  );

  return (
    <section className={s.section}>
      <h5 className={s.title}>Log groups</h5>
      <div className={s.chips}>
        {selected.map((g) => (
          <span key={`${g.region}:${g.name}`} className={s.chip} title={`${g.name} (${g.region})`}>
            {isFavorite(g) && <Icon name="favorite" size="xs" className={s.favorite} />}
            <span className={s.chipName}>{g.name}</span>
            <span className={s.region}>{g.region}</span>
            <IconButton name="times" size="xs" aria-label={`Remove ${g.name}`} onClick={() => toggle(g)} />
          </span>
        ))}
        {selected.length === 0 && <span className={s.placeholder}>No log groups selected</span>}
        <Toggletip
          placement="bottom-start"
          fitContent
          closeButton={false}
          content={picker}
          onOpen={() => found === undefined && search()}
        >
          <Button size="sm" variant={selected.length ? 'secondary' : 'primary'} icon="plus">
            {selected.length ? 'Add' : 'Add log groups'}
          </Button>
        </Toggletip>
        {selected.length > 1 && (
          <Button size="sm" variant="secondary" fill="text" onClick={() => onSelectedChange([])}>
            Clear
          </Button>
        )}
      </div>
    </section>
  );
}

function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'data' in e) {
    const data = (e as { data?: { message?: string } }).data;
    if (data?.message) {
      return data.message;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

const getStyles = (theme: GrafanaTheme2) => ({
  section: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(2), minWidth: 0 }),
  title: css({ margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }),
  chips: css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing(1), minWidth: 0 }),
  chip: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    height: theme.spacing(3),
    padding: theme.spacing(0, 0.5, 0, 1),
    borderRadius: theme.shape.radius.default,
    background: theme.colors.primary.transparent,
    border: `1px solid ${theme.colors.primary.border}`,
    fontSize: theme.typography.bodySmall.fontSize,
    maxWidth: 420,
  }),
  chipName: css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
  region: css({ color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize }),
  favorite: css({ color: theme.colors.warning.text }),
  placeholder: css({ color: theme.colors.text.secondary }),
  picker: css({ width: 560, display: 'flex', flexDirection: 'column', gap: theme.spacing(2) }),
  group: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(1) }),
  groupTitle: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  }),
  searchRow: css({ display: 'flex', gap: theme.spacing(1) }),
  list: css({ listStyle: 'none', margin: 0, padding: 0, maxHeight: 200, overflowY: 'auto' }),
  results: css({ maxHeight: 300 }),
  listItem: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.25, 0.5),
    borderRadius: theme.shape.radius.default,
    '&:hover': { background: theme.colors.action.hover },
  }),
  checkbox: css({
    flex: 1,
    minWidth: 0,
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    '& > span:last-child': { maxWidth: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  }),
  empty: css({ padding: theme.spacing(1), color: theme.colors.text.secondary }),
});
