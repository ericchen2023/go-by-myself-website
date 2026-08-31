import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const target = process.argv[2];
const variable = target === 'production' ? 'PRODUCTION_BASE_URL' : 'STAGING_BASE_URL';
const baseUrl = process.env[variable]?.trim();

if (!baseUrl) throw new Error(`ENV_CONFIG_INVALID: ${variable} is required`);

const playwrightCli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
const child = spawn(process.execPath, [playwrightCli, 'test', 'tests/e2e/staging-shell.spec.js'], {
  env: { ...process.env, E2E_BASE_URL: baseUrl },
  stdio: 'inherit'
});

child.once('error', (error) => {
  throw error;
});

child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
