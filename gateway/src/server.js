import { createServer } from 'node:http';
import { loadGatewayConfig } from './config.js';
import { CommandLedger } from './command-ledger.js';
import { ControlPlaneClient } from './control-plane-client.js';
import { SimulatorHardware } from './simulator-hardware.js';
import { GatewayWorker } from './worker.js';

const config = loadGatewayConfig();
const configured = Boolean(config.controlPlaneUrl && config.vehicleId && config.clientId && config.clientToken);
const ledger = new CommandLedger(config.stateDirectory);
await ledger.initialize();
const hardware = new SimulatorHardware();
const controlPlane = configured ? new ControlPlaneClient(config) : null;
const worker = controlPlane ? new GatewayWorker({ config, ledger, hardware, controlPlane }) : null;
worker?.start();
const telemetryTimer = worker ? setInterval(() => {
  void worker.publishTelemetry().catch((error) => {
    worker.lastError = error instanceof Error ? error.message : String(error);
  });
}, config.telemetryIntervalMs) : null;
telemetryTimer?.unref();

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://gateway.local');
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  if (request.method !== 'GET') {
    response.writeHead(405);
    response.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }
  if (url.pathname === '/health/live') {
    response.writeHead(200);
    response.end(JSON.stringify({ status: 'ok', service: 'go-by-myself-gateway' }));
    return;
  }
  if (url.pathname === '/health/ready') {
    const ready = configured && !worker?.health().lastError && hardware.health().connected;
    response.writeHead(ready ? 200 : 503);
    response.end(JSON.stringify({
      status: ready ? 'ready' : 'degraded',
      controlPlaneConfigured: configured,
      worker: worker?.health() ?? null,
      hardware: hardware.health()
    }));
    return;
  }
  response.writeHead(404);
  response.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(config.port, '127.0.0.1', () => {
  process.stdout.write(`Gateway health server listening on http://127.0.0.1:${config.port}; control plane ${configured ? 'configured' : 'degraded/unconfigured'}.\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    worker?.stop();
    if (telemetryTimer) clearInterval(telemetryTimer);
    server.close(() => process.exit(0));
  });
}
