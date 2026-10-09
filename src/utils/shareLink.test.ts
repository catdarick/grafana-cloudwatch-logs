import { fromShareParams, matchesTab, toShareParams } from './shareLink';
import { createTab } from '../state/useWorkspace';

describe('shareLink', () => {
  const groups = [
    { name: '/ecs/web', region: 'us-east-2' },
    { name: 'billing-service', region: 'us-east-1' },
  ];

  it('round-trips a relative range in Grafana style', () => {
    const params = toShareParams({
      query: 'fields @message\n| limit 20',
      logGroups: groups,
      timeRange: { mode: 'relative', amount: 30, unit: 'minutes' },
      datasourceUid: 'cw',
    });
    expect(params.get('from')).toBe('now-30m');
    expect(params.get('to')).toBe('now');
    expect(params.getAll('group')).toEqual(['us-east-2:/ecs/web', 'us-east-1:billing-service']);
    expect(fromShareParams(new URLSearchParams(params.toString()))).toEqual({
      query: 'fields @message\n| limit 20',
      logGroups: groups,
      timeRange: { mode: 'relative', amount: 30, unit: 'minutes' },
      datasourceUid: 'cw',
    });
  });

  it('round-trips an absolute range', () => {
    const params = toShareParams({ query: 'q', logGroups: [], timeRange: { mode: 'absolute', from: 1000, to: 2000 } });
    expect(fromShareParams(params)?.timeRange).toEqual({ mode: 'absolute', from: 1000, to: 2000 });
  });

  it('ignores URLs without a query and falls back on a broken range', () => {
    expect(fromShareParams(new URLSearchParams('from=now-1h'))).toBeUndefined();
    expect(fromShareParams(new URLSearchParams('query=x&from=abc&to=now'))?.timeRange).toEqual({
      mode: 'relative',
      amount: 30,
      unit: 'minutes',
    });
  });

  it('recognises a tab that already holds the shared query', () => {
    const shared = {
      query: 'q',
      logGroups: groups,
      timeRange: { mode: 'relative' as const, amount: 1, unit: 'hours' as const },
    };
    expect(matchesTab({ ...createTab(1), ...shared }, shared)).toBe(true);
    expect(matchesTab({ ...createTab(1), ...shared, query: 'other' }, shared)).toBe(false);
  });
});
