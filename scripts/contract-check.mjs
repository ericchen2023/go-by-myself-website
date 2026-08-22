import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const schemaFiles = (await readdir('contracts'))
  .filter((name) => name.endsWith('.schema.json'))
  .map((name) => join('contracts', name));

if (!schemaFiles.length) throw new Error('No versioned JSON Schema contracts found.');

for (const file of schemaFiles) {
  const schema = JSON.parse(await readFile(file, 'utf8'));
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    throw new Error(`${file}: expected JSON Schema 2020-12`);
  }
  if (schema.additionalProperties !== false) {
    throw new Error(`${file}: top-level additionalProperties must be false`);
  }
  if (!schema.properties?.schemaVersion) {
    throw new Error(`${file}: missing schemaVersion`);
  }
}

if (process.argv.includes('--fixtures')) {
  const fixtures = JSON.parse(await readFile('contracts/fixtures.json', 'utf8'));
  if (!Array.isArray(fixtures.commands) || !Array.isArray(fixtures.telemetry)) {
    throw new Error('contracts/fixtures.json: missing commands or telemetry arrays');
  }
  process.stdout.write(`Fixtures loaded: ${fixtures.commands.length} commands, ${fixtures.telemetry.length} telemetry envelopes.\n`);
}

process.stdout.write(`Validated ${schemaFiles.length} contract schemas.\n`);

