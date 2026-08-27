import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: true });
addFormats(ajv);

function schema(relativePath) {
  return JSON.parse(readFileSync(resolve('gateway/src', relativePath), 'utf8'));
}

const validateCommandSchema = ajv.compile(schema('../../contracts/delivery-command.schema.json'));
const validateTelemetrySchema = ajv.compile(schema('../../contracts/telemetry.schema.json'));

function assertSchema(validate, value, code) {
  if (!validate(value)) {
    const detail = ajv.errorsText(validate.errors, { separator: '; ' });
    const error = /** @type {Error & {code:string}} */ (new Error(detail));
    error.code = code;
    throw error;
  }
  return value;
}

export function assertCommandSchema(value) {
  return assertSchema(validateCommandSchema, value, 'COMMAND_SCHEMA_INVALID');
}

export function assertTelemetrySchema(value) {
  return assertSchema(validateTelemetrySchema, value, 'TELEMETRY_SCHEMA_INVALID');
}
