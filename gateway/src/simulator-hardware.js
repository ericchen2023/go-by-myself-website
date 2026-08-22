export class SimulatorHardware {
  constructor() {
    this.vehicleState = 'idle';
  }

  /** @param {Record<string, any>} command */
  async execute(command) {
    if (command.expectedVehicleState !== this.vehicleState) {
      return { state: 'rejected', errorCode: 'VEHICLE_STATE_MISMATCH', evidence: { currentState: this.vehicleState } };
    }
    const resultingStates = {
      DISPATCH: 'moving_to_pickup',
      OPEN_COMPARTMENT: 'compartment_open',
      CANCEL: 'safe_stopped',
      RETURN_TO_BASE: 'returning_to_base'
    };
    this.vehicleState = resultingStates[command.type] ?? this.vehicleState;
    return {
      state: 'completed',
      evidence: { simulator: true, resultingVehicleState: this.vehicleState }
    };
  }

  health() {
    return { connected: true, adapter: 'simulator', vehicleState: this.vehicleState };
  }
}

