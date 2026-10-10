import pluginJson from './plugin.json';

export const PLUGIN_ID = pluginJson.id;
export const PLUGIN_BASE_URL = `/a/${pluginJson.id}`;
export const STORAGE_KEY = `${pluginJson.id}:state:v1`;
export const DEFAULT_REGION = 'us-east-2';
