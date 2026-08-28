import { locationByCode, positionAlongRoute, ROUTE_GRAPH_CHECKSUM, ROUTE_GRAPH_VERSION, shortestRoute } from './route-contract.js';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class SimulatorHardware {
  constructor({ stepDelayMs = 20 } = {}) {
    this.vehicleState = 'idle';
    this.stepDelayMs = stepDelayMs;
    this.cancelGeneration = 0;
    this.activeCommand = null;
    this.routeParts = [];
    this.overallProgress = 0;
  }

  /** @param {Record<string, any>} command */
  async execute(command) {
    if (command.type === 'CANCEL') {
      this.cancelGeneration += 1;
      this.vehicleState = 'safe_stopped';
      this.activeCommand = null;
      return { state: 'completed', evidence: { simulator: true, resultingVehicleState: this.vehicleState, safeStop: true } };
    }

    const allowedStates = command.preconditions?.allowedVehicleStates ?? [];
    if (allowedStates.length && !allowedStates.includes(this.vehicleState)) {
      return { state: 'rejected', errorCode: 'ROBOT_STATE_INVALID', evidence: { currentState: this.vehicleState } };
    }

    if (command.type === 'DISPATCH') return this.#dispatch(command);
    if (command.type === 'RETURN_TO_BASE') {
      this.vehicleState = 'returning_to_base';
      await wait(this.stepDelayMs);
      this.vehicleState = 'at_stop';
      return { state: 'completed', evidence: { simulator: true, resultingVehicleState: this.vehicleState } };
    }
    if (command.type === 'OPEN_COMPARTMENT') {
      return { state: 'completed', evidence: { simulator: true, compartmentCapability: 'synthetic' } };
    }
    return { state: 'rejected', errorCode: 'COMMAND_TYPE_UNSUPPORTED', evidence: {} };
  }

  async #dispatch(command) {
    const from = locationByCode(command.payload.fromStopCode);
    const to = locationByCode(command.payload.toStopCode);
    this.routeParts = from && to ? shortestRoute(from.routeNodeId, to.routeNodeId) : [];
    if (!this.routeParts.length) return { state: 'rejected', errorCode: 'ROUTE_SEGMENT_NOT_ALLOWED', evidence: {} };
    const generation = this.cancelGeneration;
    this.activeCommand = command;
    this.overallProgress = 0;
    this.vehicleState = 'preparing';
    await wait(this.stepDelayMs);
    if (generation !== this.cancelGeneration) return { state: 'failed', errorCode: 'COMMAND_CANCELLED_SAFE', evidence: { safeStop: true } };
    this.vehicleState = 'localizing';
    await wait(this.stepDelayMs);
    for (let step = 1; step <= 20; step += 1) {
      if (generation !== this.cancelGeneration) return { state: 'failed', errorCode: 'COMMAND_CANCELLED_SAFE', evidence: { safeStop: true } };
      this.vehicleState = 'moving';
      this.overallProgress = step / 20;
      await wait(this.stepDelayMs);
    }
    this.vehicleState = 'at_stop';
    this.activeCommand = null;
    return {
      state: 'completed',
      evidence: {
        simulator: true,
        resultingVehicleState: this.vehicleState,
        legId: command.payload.legId,
        routeGraphChecksum: ROUTE_GRAPH_CHECKSUM
      }
    };
  }

  telemetry({ vehicleId, bootId, sequence }) {
    const position = positionAlongRoute(this.routeParts, this.overallProgress);
    return {
      schemaVersion: 2,
      vehicleId,
      bootId,
      sequence,
      messageId: crypto.randomUUID(),
      observedAt: new Date().toISOString(),
      vehicleState: this.vehicleState,
      pose: { frameId: 'simulator-site-v1', x: 0, y: 0, heading: 0 },
      speedMps: this.vehicleState === 'moving' ? 0.58 : 0,
      battery: { voltageV: 23.7, percent: null },
      quality: position ? 'valid' : 'degraded',
      route: position && this.activeCommand ? {
        legId: this.activeCommand.payload.legId,
        segmentId: position.segmentId,
        progress: position.progress,
        lateralM: 0.03,
        routeGraphVersion: ROUTE_GRAPH_VERSION,
        routeGraphChecksum: ROUTE_GRAPH_CHECKSUM
      } : null
    };
  }

  health() {
    return { connected: true, adapter: 'simulator', vehicleState: this.vehicleState };
  }
}
