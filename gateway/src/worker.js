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
        await this.controlPlane.postCommandEvent(command.commandId, prior.finalEvent);
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
      await this.controlPlane.postCommandEvent(command.commandId, uncertainEvent);
      return;
    }

    const acceptedEvent = commandEvent(command, 'accepted', ++this.sequence);
    await this.ledger.record(command.commandId, {
      acceptedEvent,
      acceptedAt: new Date().toISOString()
    });
    await this.controlPlane.postCommandEvent(command.commandId, acceptedEvent);
    const result = await this.hardware.execute(command);
    const finalEvent = commandEvent(command, result.state, ++this.sequence, result.evidence, result.errorCode);
    await this.ledger.record(command.commandId, {
      acceptedEvent,
      finalEvent,
      completedAt: new Date().toISOString()
    });
    await this.controlPlane.postCommandEvent(command.commandId, finalEvent);
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
    return { running: this.running, lastPollAt: this.lastPollAt, lastError: this.lastError };
  }
}
