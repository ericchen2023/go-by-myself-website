import AjvModule from 'npm:ajv@8.20.0/dist/2020.js';
import formatsModule from 'npm:ajv-formats@3.0.1';
import commandSchema from '../../../contracts/delivery-command.schema.json' with { type: 'json' };
import telemetrySchema from '../../../contracts/telemetry.schema.json' with { type: 'json' };
import commandEventSchema from '../../../contracts/command-event.schema.json' with { type: 'json' };
import robotFaultSchema from '../../../contracts/robot-fault.schema.json' with { type: 'json' };

const Ajv2020 = AjvModule.default;
const addFormats = formatsModule.default;
const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
addFormats(ajv);

export const validateCommand = ajv.compile(commandSchema);
export const validateTelemetry = ajv.compile(telemetrySchema);
export const validateCommandEvent = ajv.compile(commandEventSchema);
export const validateRobotFault = ajv.compile(robotFaultSchema);

export function schemaErrors(validate: { errors?: Parameters<typeof ajv.errorsText>[0] }) {
  return ajv.errorsText(validate.errors);
}
