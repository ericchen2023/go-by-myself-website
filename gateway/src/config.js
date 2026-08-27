import { resolve } from 'node:path';

export function loadGatewayConfig(environment = process.env) {
  const supportedVersion = Number(environment.SUPPORTED_CONTRACT_VERSION ?? '2');
  if (supportedVersion !== 2) throw new Error('Unknown major contract version; gateway fails closed.');
  const deployEnvironment = environment.GATEWAY_DEPLOY_ENV ?? 'local';
  const hardwareAdapter = environment.GATEWAY_HARDWARE_ADAPTER ?? 'simulator';
  if (!['local', 'test', 'staging', 'production'].includes(deployEnvironment)) {
    throw new Error(`Unknown gateway deploy environment: ${deployEnvironment}`);
  }
  if (hardwareAdapter !== 'simulator') {
    throw new Error(`Hardware adapter unavailable: ${hardwareAdapter}`);
  }
  if (deployEnvironment === 'production') {
    throw new Error('Production gateway fails closed until an approved hardware adapter is implemented.');
  }
  return Object.freeze({
    port: Number(environment.GATEWAY_PORT ?? '8788'),
    controlPlaneUrl: environment.CONTROL_PLANE_URL ?? '',
    vehicleId: environment.ROBOT_VEHICLE_ID ?? '',
    clientId: environment.ROBOT_CLIENT_ID ?? '',
    clientToken: environment.ROBOT_CLIENT_TOKEN ?? '',
    deployEnvironment,
    hardwareAdapter,
    certificatePath: environment.ROBOT_CERT_PATH ?? '',
    privateKeyPath: environment.ROBOT_PRIVATE_KEY_PATH ?? '',
    supportedVersion,
    pollIntervalMs: Number(environment.ROBOT_POLL_INTERVAL_MS ?? '2000'),
    telemetryIntervalMs: Number(environment.ROBOT_TELEMETRY_INTERVAL_MS ?? '1000'),
    stateDirectory: resolve(environment.GATEWAY_STATE_DIR ?? 'gateway/data')
  });
}
