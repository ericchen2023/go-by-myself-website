export class ControlPlaneClient {
  /** @param {{controlPlaneUrl:string, vehicleId:string, clientId:string, clientToken:string}} config */
  constructor(config) {
    this.config = config;
  }

  #headers() {
    return {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-robot-client-id': this.config.clientId,
      authorization: `Bearer ${this.config.clientToken}`
    };
  }

  /** @param {string} path */
  #url(path) {
    return new URL(`${this.config.controlPlaneUrl.replace(/\/$/, '')}${path}`);
  }

  async fetchCommands() {
    const url = this.#url('/api/v1/robot/commands');
    url.searchParams.set('vehicleId', this.config.vehicleId);
    const response = await fetch(url, { headers: this.#headers(), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Command poll failed: HTTP ${response.status}`);
    const envelope = await response.json();
    return Array.isArray(envelope.data) ? envelope.data : [];
  }

  /** @param {string} commandId @param {Record<string, unknown>} event */
  async postCommandEvent(commandId, event) {
    const url = this.#url(`/api/v1/robot/commands/${encodeURIComponent(commandId)}/events`);
    const response = await fetch(url, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`Command event failed: HTTP ${response.status}`);
  }

  /** @param {Record<string, unknown>} telemetry */
  async postTelemetry(telemetry) {
    const url = this.#url('/api/v1/robot/telemetry');
    const response = await fetch(url, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify(telemetry),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`Telemetry ingest failed: HTTP ${response.status}`);
  }
}
