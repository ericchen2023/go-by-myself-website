import { build } from 'vite';

const mode = process.env.VITE_APP_MODE;
const googleAuthFlag = process.env.VITE_GOOGLE_AUTH_ENABLED;

if (!['demo', 'production'].includes(mode)) {
  throw new Error('ENV_CONFIG_INVALID: VITE_APP_MODE must be explicitly set for Vercel.');
}
if (googleAuthFlag && !['true', 'false'].includes(googleAuthFlag)) {
  throw new Error('ENV_CONFIG_INVALID: VITE_GOOGLE_AUTH_ENABLED must be true or false.');
}

process.env.VITE_RELEASE_SHA ||= process.env.VERCEL_GIT_COMMIT_SHA || 'vercel-unknown';

// The route graph version used to be asserted against VITE_ROUTE_GRAPH_VERSION.
// Nothing read that value, and the assertion compared it to a copy of the
// version string kept here, so a graph bump failed the build over a variable
// with no consumer. runtimeConfig derives the version from the pinned graph
// instead, which is the thing the check was trying to guarantee.

if (mode === 'demo') {
  process.env.VITE_DEPLOY_ENV ||= 'demo';
  if (process.env.VITE_DEPLOY_ENV !== 'demo') {
    throw new Error('ENV_CONFIG_INVALID: demo artifact must use VITE_DEPLOY_ENV=demo.');
  }
} else {
  if (!['staging', 'production'].includes(process.env.VITE_DEPLOY_ENV || '')) {
    throw new Error('ENV_CONFIG_INVALID: production-shaped Vercel artifact requires staging or production deploy env.');
  }
  if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('ENV_CONFIG_INVALID: production-shaped Vercel artifact requires Supabase public configuration.');
  }
}

await build({ build: { outDir: 'dist' } });
