import { describe, expect, it } from 'vitest';
import { loadGatewayConfig } from '../../gateway/src/config.js';
import { CommandRejection, validateCommand } from '../../gateway/src/protocol.js';
import { GatewayWorker } from '../../gateway/src/worker.js';
import fixtures from '../../contracts/fixtures.json';

class MemoryLedger {
  constructor() { this.records = new Map(); }
  get(commandId) { return this.records.get(commandId) ?? null; }
  async record(commandId, value) { this.records.set(commandId, value); }
}

function workerFixture(prior = null) {
  const command = { ...fixtures.commands[0], expiresAt: '2099-08-22T02:05:00Z' };
  const ledger = new MemoryLedger();
  if (prior) ledger.records.set(command.commandId, prior);
  const events = [];
  let executions = 0;
  const worker = new GatewayWorker({
    config: { vehicleId: command.vehicleId, pollIntervalMs: 2000 },
    ledger,
    hardware: { execute: async () => { executions += 1; return { state: 'completed', evidence: { test: true } }; } },
    controlPlane: {
      fetchCommands: async () => [command],
      postCommandEvent: async (_commandId, event) => { events.push(event); }
    }
  });
  return { worker, ledger, events, getExecutions: () => executions };
}

describe('robot gateway command validation', () => {
  const command = fixtures.commands[0];

  it('accepts the supported contract for the assigned vehicle', () => {
    expect(validateCommand(command, command.vehicleId, new Date('2026-08-22T02:01:00Z')).commandId).toBe(command.commandId);
  });

  it('fails closed on unknown major versions', () => {
    expect(() => validateCommand({ ...command, schemaVersion: 3 }, command.vehicleId, new Date('2026-08-22T02:01:00Z'))).toThrow(CommandRejection);
  });

  it('rejects wrong vehicle and late commands', () => {
    expect(() => validateCommand(command, 'b0000000-0000-4000-8000-000000000001', new Date('2026-08-22T02:01:00Z'))).toThrow(/another vehicle/);
    expect(() => validateCommand(command, command.vehicleId, new Date('2026-08-22T02:31:00Z'))).toThrow(/expired/);
  });

  it('persists acceptance before execution and replays a final event without executing twice', async () => {
    const fixture = workerFixture();
    await fixture.worker.pollOnce();
    await fixture.worker.pollOnce();
    await fixture.worker.waitForIdle();
    expect(fixture.getExecutions()).toBe(1);
    expect(fixture.ledger.get(fixtures.commands[0].commandId).finalEvent.event).toBe('completed');
    expect(fixture.events.map((event) => event.event)).toEqual(['accepted', 'completed', 'completed']);
  });

  it('fails closed after restart when a persisted accepted command has no known outcome', async () => {
    const fixture = workerFixture({ acceptedEvent: { event: 'accepted' }, acceptedAt: '2026-08-22T02:00:00Z' });
    await fixture.worker.pollOnce();
    expect(fixture.getExecutions()).toBe(0);
    expect(fixture.events[0]).toMatchObject({ event: 'failed', errorCode: 'COMMAND_OUTCOME_UNKNOWN' });
  });

  it('does not permit the simulator gateway in a production deployment', () => {
    expect(() => loadGatewayConfig({
      SUPPORTED_CONTRACT_VERSION: '1',
      GATEWAY_DEPLOY_ENV: 'production',
      GATEWAY_HARDWARE_ADAPTER: 'simulator'
    })).toThrow(/fails closed/);
  });

  it('keeps polling responsive while a long dispatch is executing so CANCEL can run', async () => {
    const dispatch = { ...fixtures.commands[0], expiresAt: '2099-08-22T02:30:00Z' };
    const cancel = { ...fixtures.commands[1], expiresAt: '2099-08-22T02:32:00Z' };
    let poll = 0;
    let releaseDispatch = () => {};
    /** @type {Promise<void>} */
    const dispatchWait = new Promise((resolve) => { releaseDispatch = () => resolve(); });
    const executed = [];
    const worker = new GatewayWorker({
      config: { vehicleId: dispatch.vehicleId, pollIntervalMs: 2000 },
      ledger: new MemoryLedger(),
      hardware: {
        execute: async (command) => {
          executed.push(command.type);
          if (command.type === 'DISPATCH') await dispatchWait;
          return { state: 'completed', evidence: { test: true } };
        }
      },
      controlPlane: {
        fetchCommands: async () => (poll++ === 0 ? [dispatch] : [cancel]),
        postCommandEvent: async () => {}
      }
    });
    await worker.pollOnce();
    await worker.pollOnce();
    expect(executed).toContain('CANCEL');
    releaseDispatch();
    await worker.waitForIdle();
  });

  it('executes and preserves the physical result when event delivery is temporarily unavailable', async () => {
    const command = { ...fixtures.commands[0], expiresAt: '2099-08-22T02:30:00Z' };
    const ledger = new MemoryLedger();
    const delivered = [];
    let attempts = 0;
    const worker = new GatewayWorker({
      config: { vehicleId: command.vehicleId, pollIntervalMs: 2000 },
      ledger,
      hardware: { execute: async () => ({ state: 'completed', evidence: { arrival: 'verified' } }) },
      controlPlane: {
        fetchCommands: async () => [command],
        postCommandEvent: async (_commandId, event) => {
          attempts += 1;
          if (attempts <= 2) throw new Error('temporary transport failure');
          delivered.push(event);
        }
      }
    });

    await worker.pollOnce();
    await worker.waitForIdle();
    expect(ledger.get(command.commandId).finalEvent).toMatchObject({ event: 'completed', evidence: { arrival: 'verified' } });

    await worker.pollOnce();
    expect(delivered.at(-1)).toMatchObject({ event: 'completed', evidence: { arrival: 'verified' } });
  });
});
