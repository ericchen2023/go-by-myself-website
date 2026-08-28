import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertCommandSchema } from './contract-validator.js';

const routeGraph = JSON.parse(readFileSync(resolve('contracts/route-graph.v4.json'), 'utf8'));
const physicalManifest = JSON.parse(readFileSync(resolve('contracts/physical-route-manifest.v1.json'), 'utf8'));

export class CommandRejection extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CommandRejection';
    this.code = code;
  }
}

/** @param {unknown} value @param {string} vehicleId @param {Date} [now] */
export function validateCommand(value, vehicleId, now = new Date()) {
  if (!value || typeof value !== 'object') throw new CommandRejection('COMMAND_SCHEMA_INVALID', 'Command must be an object.');
  const command = /** @type {Record<string, any>} */ (value);
  if (command.schemaVersion !== 2) throw new CommandRejection('COMMAND_VERSION_UNSUPPORTED', 'Unknown major command version.');
  try {
    assertCommandSchema(command);
  } catch (error) {
    throw new CommandRejection('COMMAND_SCHEMA_INVALID', error instanceof Error ? error.message : 'Command schema invalid.');
  }
  if (command.vehicleId !== vehicleId) throw new CommandRejection('COMMAND_VEHICLE_MISMATCH', 'Command is assigned to another vehicle.');
  if (!Number.isFinite(Date.parse(command.expiresAt)) || Date.parse(command.expiresAt) <= now.getTime()) {
    throw new CommandRejection('COMMAND_EXPIRED', 'Late or expired command rejected.');
  }
  if (command.type === 'DISPATCH') {
    if (command.payload.routeGraphVersion !== routeGraph.version || command.payload.routeGraphChecksum !== routeGraph.checksum) {
      throw new CommandRejection('ROUTE_VERSION_MISMATCH', 'Route graph version or checksum does not match the pinned contract.');
    }
    const physicalLeg = physicalManifest.legs.find((leg) => leg.legId === command.payload.legId);
    const syntheticLeg = String(command.payload.legId).startsWith('SIM_');
    if (!physicalLeg && !syntheticLeg) {
      throw new CommandRejection('ROUTE_SEGMENT_NOT_ALLOWED', 'Physical leg is not in the pinned route manifest.');
    }
    if (physicalLeg && (
      physicalManifest.capabilityEnabled !== true
      || physicalManifest.mappingStatus !== 'approved'
      || !Array.isArray(physicalLeg.allowedSegmentIds)
      || physicalLeg.allowedSegmentIds.length === 0
    )) {
      throw new CommandRejection('PHYSICAL_CAPABILITY_DISABLED', 'Physical route mapping is not approved in the pinned manifest.');
    }
  }
  return command;
}

/** @param {Record<string, any>} command @param {'accepted'|'rejected'|'completed'|'failed'} event @param {number} sourceSequence @param {Record<string, unknown>} [evidence] @param {string} [errorCode] */
export function commandEvent(command, event, sourceSequence, evidence = {}, errorCode = '') {
  return {
    schemaVersion: 2,
    commandId: command.commandId,
    eventId: crypto.randomUUID(),
    event,
    observedAt: new Date().toISOString(),
    sourceSequence,
    ...(errorCode ? { errorCode } : {}),
    evidence
  };
}
