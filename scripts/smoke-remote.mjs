const target = process.argv[2];
const variable = target === 'production' ? 'PRODUCTION_BASE_URL' : 'STAGING_BASE_URL';
const baseUrl = process.env[variable];

if (!baseUrl) throw new Error(`ENV_CONFIG_INVALID: ${variable} is required`);

const response = await fetch(new URL('/health.json', baseUrl), {
  redirect: 'error',
  signal: AbortSignal.timeout(10_000)
});

if (!response.ok) throw new Error(`${target} smoke failed with HTTP ${response.status}`);
const health = await response.json();
if (health.status !== 'ok') throw new Error(`${target} health is not ok`);
process.stdout.write(`${target} health smoke passed.\n`);

