import { describe, expect, it } from 'vitest';
import fixtures from '../../contracts/fixtures.json';
import { assertCommandSchema, assertTelemetrySchema } from '../../gateway/src/contract-validator.js';
import { CommandRejection, validateCommand } from '../../gateway/src/protocol.js';

describe('robot contract v2', () => {
  it('validates command and telemetry fixtures with nullable battery percentage', () => {
    expect(assertCommandSchema(fixtures.commands[0])).toBe(fixtures.commands[0]);
    expect(assertTelemetrySchema(fixtures.telemetry[0])).toBe(fixtures.telemetry[0]);
    expect(fixtures.telemetry[0].battery).toEqual({ voltageV: 23.7, percent: null });
  });

  it('rejects v1, wrong checksum, and an unpinned leg', () => {
    const command = fixtures.commands[0];
    const now = new Date('2026-08-22T02:01:00Z');
    expect(() => validateCommand({ ...command, schemaVersion: 1 }, command.vehicleId, now)).toThrow(CommandRejection);
    expect(() => validateCommand({
      ...command,
      payload: { ...command.payload, routeGraphChecksum: `sha256:${'0'.repeat(64)}` }
    }, command.vehicleId, now)).toThrow(/checksum/);
    expect(() => validateCommand({
      ...command,
      payload: { ...command.payload, legId: 'UNKNOWN_LEG' }
    }, command.vehicleId, now)).toThrow(/manifest/);
  });

  it('keeps CANCEL independent from racing vehicle state', () => {
    const cancel = fixtures.commands[1];
    expect(cancel).not.toHaveProperty('preconditions');
    expect(validateCommand(cancel, cancel.vehicleId, new Date('2026-08-22T02:03:00Z')).type).toBe('CANCEL');
    expect(() => assertCommandSchema({
      ...cancel,
      preconditions: { allowedVehicleStates: ['moving'] }
    })).toThrow();
  });

  it('rejects telemetry that invents a battery percentage outside the contract', () => {
    expect(() => assertTelemetrySchema({
      ...fixtures.telemetry[0],
      battery: { voltageV: 23.7, percent: 120 }
    })).toThrow();
  });
});
