const mode = process.env.VITE_APP_MODE ?? 'demo';
const deployEnv = process.env.VITE_DEPLOY_ENV ?? (mode === 'demo' ? 'demo' : 'local');
const allowedModes = new Set(['demo', 'production']);
const allowedDeployEnvs = new Set(['demo', 'local', 'test', 'staging', 'production']);

if (!allowedModes.has(mode) || !allowedDeployEnvs.has(deployEnv)) {
  throw new Error(`ENV_CONFIG_INVALID: mode=${mode}, deployEnv=${deployEnv}`);
}

if (mode === 'demo') {
  const forbidden = [
    'SUPABASE_SECRET_KEYS',
    'SUPABASE_SECRET_KEY',
    'CREDENTIAL_PEPPER_V1',
    'SMS_PROVIDER_API_KEY',
    'ROBOT_PRIVATE_KEY_PATH'
  ].filter((name) => process.env[name]);
  if (forbidden.length) {
    throw new Error(`ENV_CONFIG_INVALID: demo process must not receive ${forbidden.join(', ')}`);
  }
  process.stdout.write('Demo environment valid: zero server/robot secrets required.\n');
  process.exit(0);
}

const browserRequired = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];
const missing = browserRequired.filter((name) => !process.env[name]);

if (missing.length) {
  throw new Error(`ENV_CONFIG_INVALID: missing ${missing.join(', ')}`);
}

if (deployEnv === 'production' && process.env.GATEWAY_HARDWARE_ADAPTER === 'simulator') {
  throw new Error('ENV_CONFIG_INVALID: simulator gateway cannot be enabled in production');
}

process.stdout.write(`Production-shaped environment valid for ${deployEnv}.\n`);
