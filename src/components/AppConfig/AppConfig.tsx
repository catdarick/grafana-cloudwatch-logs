import React, { useState } from 'react';
import { lastValueFrom } from 'rxjs';
import { AppPluginMeta, PluginConfigPageProps, PluginMeta } from '@grafana/data';
import { DataSourcePicker, getBackendSrv } from '@grafana/runtime';
import { Button, Field, FieldSet, Input } from '@grafana/ui';
import { AppSettings } from '../../types';
import { testIds } from '../testIds';

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<AppSettings>> {}

const AppConfig = ({ plugin }: AppConfigProps) => {
  const { enabled, pinned, jsonData } = plugin.meta;
  const [datasourceUid, setDatasourceUid] = useState(jsonData?.datasourceUid);
  const [defaultRegion, setDefaultRegion] = useState(jsonData?.defaultRegion ?? '');

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updatePluginAndReload(plugin.meta.id, {
      enabled,
      pinned,
      jsonData: { datasourceUid, defaultRegion: defaultRegion.trim() || undefined },
    });
  };

  return (
    <form onSubmit={onSubmit}>
      <FieldSet label="Defaults">
        <Field label="CloudWatch data source" description="Used when the page opens. Users can still switch it.">
          <div data-testid={testIds.appConfig.datasource}>
            <DataSourcePicker
              pluginId="cloudwatch"
              current={datasourceUid ?? null}
              width={60}
              onChange={(ds) => setDatasourceUid(ds.uid)}
            />
          </div>
        </Field>
        <Field
          label="Default region"
          description="Region for browsing log groups. Empty means the data source's default."
        >
          <Input
            width={60}
            data-testid={testIds.appConfig.region}
            value={defaultRegion}
            placeholder="us-east-2"
            onChange={(e) => setDefaultRegion(e.currentTarget.value)}
          />
        </Field>
        <Button type="submit" data-testid={testIds.appConfig.submit}>
          Save settings
        </Button>
      </FieldSet>
    </form>
  );
};

export default AppConfig;

const updatePluginAndReload = async (pluginId: string, data: Partial<PluginMeta<AppSettings>>) => {
  try {
    await lastValueFrom(
      getBackendSrv().fetch({
        url: `/api/plugins/${pluginId}/settings`,
        method: 'POST',
        data,
      })
    );
    // Plugin settings are only read on load, so reload to apply them.
    window.location.reload();
  } catch (e) {
    console.error('Error while updating the plugin', e);
  }
};
