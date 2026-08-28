import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { routePairs, routePairSqlTuple } from './route-seed-lib.mjs';

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

const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: true });
addFormats(ajv);
const commandSchema = JSON.parse(await readFile('contracts/delivery-command.schema.json', 'utf8'));
const telemetrySchema = JSON.parse(await readFile('contracts/telemetry.schema.json', 'utf8'));
const robotFaultSchema = JSON.parse(await readFile('contracts/robot-fault.schema.json', 'utf8'));
const validateCommand = ajv.compile(commandSchema);
const validateTelemetry = ajv.compile(telemetrySchema);
const validateRobotFault = ajv.compile(robotFaultSchema);

const routeGraph = JSON.parse(await readFile('contracts/route-graph.v4.json', 'utf8'));
const expectedChecksum = routeGraph.checksum;
delete routeGraph.checksum;
const actualChecksum = `sha256:${createHash('sha256').update(JSON.stringify(routeGraph)).digest('hex')}`;
if (actualChecksum !== expectedChecksum) {
  throw new Error(`contracts/route-graph.v4.json: checksum mismatch; expected ${expectedChecksum}, got ${actualChecksum}`);
}
const stopCodes = routeGraph.locations.map((location) => location.code);
if (stopCodes.length !== 4 || new Set(stopCodes).size !== 4) {
  throw new Error('contracts/route-graph.v4.json: exactly four unique visible stops are required');
}
const edgeIds = new Set(routeGraph.edges.map((edge) => edge.id));
if (edgeIds.size !== routeGraph.edges.length) throw new Error('contracts/route-graph.v4.json: duplicate edge id');

const manifest = JSON.parse(await readFile('contracts/physical-route-manifest.v1.json', 'utf8'));
if (manifest.routeGraphVersion !== routeGraph.version || manifest.routeGraphChecksum !== expectedChecksum) {
  throw new Error('contracts/physical-route-manifest.v1.json: route version/checksum mismatch');
}

const supabaseConfig = await readFile('supabase/config.toml', 'utf8');
if (!/\[functions\.robot-api\][\s\S]*?verify_jwt\s*=\s*false/.test(supabaseConfig)) {
  throw new Error('supabase/config.toml: robot-api must disable platform JWT before per-client authentication can run');
}
const robotApiSource = await readFile('supabase/functions/robot-api/index.ts', 'utf8');
if (robotApiSource.includes("Deno.env.get('ROBOT_GATEWAY_TOKEN')")) {
  throw new Error('robot-api: global robot token is forbidden; use per-client token scope');
}
for (const marker of ['ingest_robot_telemetry_v2', "environmentKey(clientId, 'TOKEN')", 'validateTelemetry', 'rawRecorded']) {
  if (!robotApiSource.includes(marker)) throw new Error(`robot-api: missing trusted v2 boundary marker ${marker}`);
}
const telemetryMigration = await readFile('supabase/migrations/202608280009_robot_events_telemetry_realtime.sql', 'utf8');
for (const marker of ['vehicle_boot_sessions', 'TELEMETRY_OUT_OF_ORDER', "interval '10 seconds'", "interval '60 seconds'"]) {
  if (!telemetryMigration.includes(marker)) throw new Error(`telemetry migration: missing safety marker ${marker}`);
}
if (manifest.mappingStatus !== 'approved' && manifest.capabilityEnabled) {
  throw new Error('contracts/physical-route-manifest.v1.json: unapproved mapping cannot enable physical capability');
}
for (const leg of manifest.legs) {
  for (const edgeId of leg.allowedSegmentIds) {
    if (!edgeIds.has(edgeId)) throw new Error(`Physical leg ${leg.legId} references unknown edge ${edgeId}`);
  }
}

const migration = (await readFile('supabase/migrations/202608280006_route_contract_v2.sql', 'utf8')).replace(/\s+/g, '');
for (const pair of routePairs(routeGraph)) {
  const tuple = routePairSqlTuple(pair).replace(/\s+/g, '');
  if (!migration.includes(tuple)) throw new Error(`Route seed migration is missing generated pair ${pair.from} -> ${pair.to}`);
}

if (process.argv.includes('--fixtures')) {
  const fixtures = JSON.parse(await readFile('contracts/fixtures.json', 'utf8'));
  if (!Array.isArray(fixtures.commands) || !Array.isArray(fixtures.telemetry) || !Array.isArray(fixtures.faults)) {
    throw new Error('contracts/fixtures.json: missing commands, telemetry, or fault arrays');
  }
  fixtures.commands.forEach((fixture, index) => {
    if (!validateCommand(fixture)) throw new Error(`Command fixture ${index} invalid: ${ajv.errorsText(validateCommand.errors)}`);
  });
  fixtures.telemetry.forEach((fixture, index) => {
    if (!validateTelemetry(fixture)) throw new Error(`Telemetry fixture ${index} invalid: ${ajv.errorsText(validateTelemetry.errors)}`);
  });
  fixtures.faults.forEach((fixture, index) => {
    if (!validateRobotFault(fixture)) throw new Error(`Fault fixture ${index} invalid: ${ajv.errorsText(validateRobotFault.errors)}`);
  });
  const invalidFixtures = JSON.parse(await readFile('contracts/invalid-fixtures.json', 'utf8'));
  invalidFixtures.commands.forEach((fixture) => {
    if (validateCommand(fixture.value)) throw new Error(`Invalid command fixture unexpectedly passed: ${fixture.name}`);
  });
  invalidFixtures.telemetry.forEach((fixture) => {
    if (validateTelemetry(fixture.value)) throw new Error(`Invalid telemetry fixture unexpectedly passed: ${fixture.name}`);
  });
  invalidFixtures.faults.forEach((fixture) => {
    if (validateRobotFault(fixture.value)) throw new Error(`Invalid fault fixture unexpectedly passed: ${fixture.name}`);
  });
  process.stdout.write(`Fixtures loaded: ${fixtures.commands.length} commands, ${fixtures.telemetry.length} telemetry envelopes, ${fixtures.faults.length} fault envelopes.\n`);
}

process.stdout.write(`Validated ${schemaFiles.length} contract schemas and canonical route ${routeGraph.version}.\n`);
