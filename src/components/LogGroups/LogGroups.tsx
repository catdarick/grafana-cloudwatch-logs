import React, { useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, Icon, IconButton, Input, Spinner, useStyles2 } from '@grafana/ui';
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
  const [browseOpen, setBrowseOpen] = useState(favorites.length === 0);
  const [region, setRegion] = useState(defaultRegion);
  const [prefix, setPrefix] = useState('');
  const [found, setFound] = useState<LogGroupRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const isSelected = (g: LogGroupRef) => selected.some((x) => sameGroup(x, g));
  const isFavorite = (g: LogGroupRef) => favorites.some((x) => sameGroup(x, g));
  const toggle = (g: LogGroupRef) =>
    onSelectedChange(isSelected(g) ? selected.filter((x) => !sameGroup(x, g)) : [...selected, g]);

  // Selected groups that are not favorites still need a chip so they can be deselected.
  const chips = [...favorites, ...selected.filter((g) => !isFavorite(g))];

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

  return (
    <section className={s.section}>
      <div className={s.header}>
        <h5 className={s.title}>
          Log groups <span className={s.badge}>{selected.length} selected</span>
        </h5>
        <Button
          variant="secondary"
          size="sm"
          fill="text"
          icon={browseOpen ? 'angle-down' : 'angle-right'}
          onClick={() => setBrowseOpen(!browseOpen)}
        >
          Other groups
        </Button>
      </div>

      {chips.length > 0 && (
        <div className={s.chips}>
          <Icon name="star" className={s.star} title="Favorites" />
          {chips.map((g) => (
            <button
              key={`${g.region}:${g.name}`}
              type="button"
              className={cx(s.chip, isSelected(g) && s.chipActive)}
              onClick={() => toggle(g)}
            >
              {isSelected(g) && <Icon name="check" />}
              {g.name} <span className={s.region}>({g.region})</span>
            </button>
          ))}
        </div>
      )}

      {browseOpen && (
        <div className={s.browse}>
          <div className={s.searchRow}>
            <Input width={18} value={region} onChange={(e) => setRegion(e.currentTarget.value)} prefix="Region" />
            <Input
              value={prefix}
              placeholder="Log group name prefix, e.g. /k8s/"
              onChange={(e) => setPrefix(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
            />
            <Button onClick={search} disabled={!datasourceUid || loading} icon="search">
              Search
            </Button>
          </div>
          {loading && <Spinner />}
          {error && (
            <Alert severity="error" title="Could not list log groups">
              {error}
            </Alert>
          )}
          <ul className={s.list}>
            {found.map((g) => (
              <li key={g.arn ?? g.name} className={s.listItem}>
                <IconButton
                  name={isFavorite(g) ? 'favorite' : 'star'}
                  tooltip={isFavorite(g) ? 'Remove from favorites' : 'Add to favorites'}
                  onClick={() => onToggleFavorite(g)}
                />
                <label className={s.listLabel}>
                  <input type="checkbox" checked={isSelected(g)} onChange={() => toggle(g)} /> {g.name}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
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
  section: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(1) }),
  header: css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }),
  title: css({ margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }),
  badge: css({
    marginLeft: theme.spacing(1),
    padding: theme.spacing(0.25, 1),
    borderRadius: theme.shape.radius.pill,
    background: theme.colors.background.secondary,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  chips: css({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    background: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
  }),
  star: css({ color: theme.colors.warning.text }),
  chip: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.5, 1.5),
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
    color: theme.colors.text.primary,
    cursor: 'pointer',
  }),
  chipActive: css({
    background: theme.colors.primary.main,
    borderColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
  }),
  region: css({ opacity: 0.75 }),
  browse: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
  }),
  searchRow: css({ display: 'flex', gap: theme.spacing(1) }),
  list: css({ listStyle: 'none', margin: 0, padding: 0, maxHeight: 240, overflowY: 'auto' }),
  listItem: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1) }),
  listLabel: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1), margin: 0, cursor: 'pointer' }),
});
