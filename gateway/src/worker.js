import { commandEvent, CommandRejection, validateCommand } from './protocol.js';

export class GatewayWorker {
  /** @param {{config:any, ledger:any, hardware:any, controlPlane:any}} dependencies */
  constructor(dependencies) {
    this.config = dependencies.config;
    this.ledger = dependencies.ledger;
    this.hardware = dependencies.hardware;
    this.controlPlane = dependencies.controlPlane;
    this.sequence = 0;
    this.lastPollAt = null;
    this.lastError = null;
    this.running = false;
    this.activeExecutions = new Map();
    this.telemetrySequence = 0;
    this.bootId = crypto.randomUUID();
  }

  async pollOnce() {
    const commands = await this.controlPlane.fetchCommands();
    this.lastPollAt = new Date().toISOString();
    this.lastError = null;
    for (const raw of commands) await this.#handle(raw);
    return commands.length;
  }

  /** @param {unknown} raw */
  async #handle(raw) {
    let command;
    try {
      command = validateCommand(raw, this.config.vehicleId);
    } catch (error) {
      if (error instanceof CommandRejection && raw && typeof raw === 'object' && 'commandId' in raw) {
        const rejected = commandEvent(/** @type {Record<string, any>} */ (raw), 'rejected', ++this.sequence, {}, error.code);
        await this.controlPlane.postCommandEvent(String(raw.commandId), rejected);
        return;
      }
      throw error;
    }

    const prior = this.ledger.get(command.commandId);
    if (prior) {
      if (prior.finalEvent) {
        await this.#postEvent(command.commandId, prior.finalEvent);
        return;
      }
      if (this.activeExecutions.has(command.commandId) && prior.acceptedEvent) {
        await this.#postEvent(command.commandId, prior.acceptedEvent);
        return;
      }
      const uncertainEvent = commandEvent(
        command,
        'failed',
        ++this.sequence,
        { recovery: 'operator_reconciliation_required' },
        'COMMAND_OUTCOME_UNKNOWN'
      );
      await this.ledger.record(command.commandId, {
        ...prior,
        finalEvent: uncertainEvent,
        completedAt: new Date().toISOString()
      });
      await this.#postEvent(command.commandId, uncertainEvent);
      return;
    }

    const acceptedEvent = commandEvent(command, 'accepted', ++this.sequence);
    await this.ledger.record(command.commandId, {
      acceptedEvent,
      acceptedAt: new Date().toISOString()
    });
    const acceptedDelivery = this.#postEvent(command.commandId, acceptedEvent);
    const execution = this.#execute(command, acceptedEvent, acceptedDelivery)
      .finally(() => this.activeExecutions.delete(command.commandId));
    this.activeExecutions.set(command.commandId, execution);
  }

  async #postEvent(commandId, event) {
    try {
      await this.controlPlane.postCommandEvent(commandId, event);
      return true;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  async #execute(command, acceptedEvent, acceptedDelivery) {
    let finalEvent;
    try {
      const result = await this.hardware.execute(command);
      finalEvent = commandEvent(command, result.state, ++this.sequence, result.evidence, result.errorCode);
    } catch (error) {
      finalEvent = commandEvent(command, 'failed', ++this.sequence, {}, error && typeof error === 'object' && 'code' in error ? String(error.code) : 'HARDWARE_EXECUTION_FAILED');
    }
    await this.ledger.record(command.commandId, { acceptedEvent, finalEvent, completedAt: new Date().toISOString() });
    await acceptedDelivery;
    await this.#postEvent(command.commandId, finalEvent);
  }

  async publishTelemetry() {
    if (typeof this.hardware.telemetry !== 'function' || typeof this.controlPlane.postTelemetry !== 'function') return;
    const envelope = this.hardware.telemetry({
      vehicleId: this.config.vehicleId,
      bootId: this.bootId,
      sequence: ++this.telemetrySequence
    });
    await this.controlPlane.postTelemetry(envelope);
  }

  async waitForIdle() {
    await Promise.allSettled([...this.activeExecutions.values()]);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      try {
        await this.pollOnce();
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
      } finally {
        if (this.running) setTimeout(tick, this.config.pollIntervalMs).unref();
      }
    };
    void tick();
  }

  stop() {
    this.running = false;
  }

  health() {
    return { running: this.running, lastPollAt: this.lastPollAt, lastError: this.lastError, inFlightCommands: this.activeExecutions.size };
  }
}
