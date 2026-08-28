const allowedModes = new Set(['demo', 'production']);
const appMode = __APP_MODE__;

if (!allowedModes.has(appMode)) {
  throw new Error(`ENV_CONFIG_INVALID: unsupported app mode ${appMode}`);
}

export const runtimeConfig = Object.freeze({
  appMode,
  deployEnv: import.meta.env.VITE_DEPLOY_ENV || (appMode === 'demo' ? 'demo' : 'local'),
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
  releaseSha: import.meta.env.VITE_RELEASE_SHA || 'local',
  routeGraphVersion: import.meta.env.VITE_ROUTE_GRAPH_VERSION || 'ndhu-four-stop-route-v4',
  supportUrl: import.meta.env.VITE_SUPPORT_URL || '/support'
});

export function assertProductionBrowserConfig() {
  if (runtimeConfig.appMode !== 'production') return;
  if (!runtimeConfig.supabaseUrl || !runtimeConfig.supabasePublishableKey) {
    throw new Error('ENV_CONFIG_INVALID: production Supabase URL/publishable key 尚未設定。');
  }
}
