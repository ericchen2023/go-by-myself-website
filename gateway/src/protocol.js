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
  if (command.schemaVersion !== 1) throw new CommandRejection('COMMAND_VERSION_UNSUPPORTED', 'Unknown major command version.');
  for (const field of ['commandId', 'correlationId', 'idempotencyKey', 'vehicleId', 'deliveryId', 'type', 'issuedAt', 'expiresAt', 'expectedVehicleState']) {
    if (typeof command[field] !== 'string' || !command[field]) throw new CommandRejection('COMMAND_SCHEMA_INVALID', `Missing ${field}.`);
  }
  if (!['DISPATCH', 'OPEN_COMPARTMENT', 'CANCEL', 'RETURN_TO_BASE'].includes(command.type)) {
    throw new CommandRejection('COMMAND_TYPE_UNSUPPORTED', 'Unsupported command type.');
  }
  if (command.vehicleId !== vehicleId) throw new CommandRejection('COMMAND_VEHICLE_MISMATCH', 'Command is assigned to another vehicle.');
  if (!Number.isFinite(Date.parse(command.expiresAt)) || Date.parse(command.expiresAt) <= now.getTime()) {
    throw new CommandRejection('COMMAND_EXPIRED', 'Late or expired command rejected.');
  }
  if (!command.payload || typeof command.payload !== 'object' || Array.isArray(command.payload)) {
    throw new CommandRejection('COMMAND_SCHEMA_INVALID', 'Payload must be an object.');
  }
  return command;
}

/** @param {Record<string, any>} command @param {'accepted'|'rejected'|'completed'|'failed'} event @param {number} sourceSequence @param {Record<string, unknown>} [evidence] @param {string} [errorCode] */
export function commandEvent(command, event, sourceSequence, evidence = {}, errorCode = '') {
  return {
    schemaVersion: 1,
    commandId: command.commandId,
    eventId: crypto.randomUUID(),
    event,
    observedAt: new Date().toISOString(),
    sourceSequence,
    ...(errorCode ? { errorCode } : {}),
    evidence
  };
}

