import { createClient } from 'npm:@supabase/supabase-js@2';
import { schemaErrors, validateCommand, validateCommandEvent, validateRobotFault, validateTelemetry } from './contract.ts';

const MAX_BODY_BYTES = 64 * 1024;
const rateWindows = new Map<string, { startedAt: number; count: number }>();

const stableCodes = new Set([
  'ROUTE_VERSION_MISMATCH',
  'ROUTE_SEGMENT_NOT_ALLOWED',
  'TELEMETRY_OUT_OF_ORDER',
  'ROBOT_STATE_INVALID',
  'COMMAND_EXPIRED',
  'COMMAND_EVENT_INVALID_TRANSITION',
  'ROBOT_SCOPE_DENIED'
]);

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

function equal(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left[index] ^ right[index];
  return result === 0;
}

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}

function environmentKey(clientId: string, suffix: 'TOKEN' | 'VEHICLE_ID') {
  return `ROBOT_${clientId.toUpperCase().replaceAll('-', '_')}_${suffix}`;
}

function allowRequest(clientId: string, path: string) {
  const key = `${clientId}:${path.includes('/telemetry') ? 'telemetry' : 'command'}`;
  const now = Date.now();
  const limit = path.includes('/telemetry') ? 180 : 60;
  const current = rateWindows.get(key);
  if (!current || now - current.startedAt >= 60_000) {
    rateWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

async function readJson(request: Request) {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) throw Object.assign(new Error('Request body too large.'), { code: 'PAYLOAD_TOO_LARGE' });
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw Object.assign(new Error('Request body too large.'), { code: 'PAYLOAD_TOO_LARGE' });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('JSON body is invalid.'), { code: 'CONTRACT_SCHEMA_INVALID' });
  }
}

function schemaFailure(validate: Parameters<typeof schemaErrors>[0], requestId: string) {
  return response(422, {
    requestId,
    error: { code: 'CONTRACT_SCHEMA_INVALID', message: schemaErrors(validate), retryable: false }
  });
}

function databaseError(error: { message?: string }, requestId: string) {
  const code = [...stableCodes].find((candidate) => error.message?.includes(candidate)) ?? 'ROBOT_API_FAILED';
  const status = code === 'ROBOT_SCOPE_DENIED' ? 403 : code === 'ROBOT_API_FAILED' ? 500 : 409;
  return response(status, {
    requestId,
    error: { code, message: code === 'ROBOT_API_FAILED' ? 'Robot operation failed.' : code, retryable: code === 'TELEMETRY_OUT_OF_ORDER' }
  });
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const clientId = request.headers.get('x-robot-client-id') ?? '';
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/i.test(clientId)) {
    return response(401, { requestId, error: { code: 'ROBOT_IDENTITY_INVALID', message: 'Robot identity rejected.', retryable: false } });
  }
  const expectedToken = Deno.env.get(environmentKey(clientId, 'TOKEN')) ?? '';
  const vehicleId = Deno.env.get(environmentKey(clientId, 'VEHICLE_ID')) ?? '';
  if (!expectedToken || !vehicleId || !equal(await digest(authorization), await digest(`Bearer ${expectedToken}`))) {
    return response(401, { requestId, error: { code: 'ROBOT_IDENTITY_INVALID', message: 'Robot identity rejected.', retryable: false } });
  }

  const url = Deno.env.get('SUPABASE_URL');
  const secretKey = Deno.env.get('SUPABASE_SECRET_KEY');
  if (!url || !secretKey) {
    return response(503, { requestId, error: { code: 'ENV_CONFIG_INVALID', message: 'Robot control plane is not configured.', retryable: false } });
  }
  const path = new URL(request.url).pathname.replace(/^\/robot-api/, '');
  if (!allowRequest(clientId, path)) {
    return response(429, { requestId, error: { code: 'RATE_LIMITED', message: 'Robot request rate exceeded.', retryable: true } });
  }
  const client = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    if (request.method === 'GET' && path === '/api/v1/robot/commands') {
      const requestUrl = new URL(request.url);
      if (requestUrl.searchParams.get('vehicleId') !== vehicleId) {
        return response(403, { requestId, error: { code: 'ROBOT_SCOPE_DENIED', message: 'Vehicle scope denied.', retryable: false } });
      }
      let query = client.from('vehicle_commands').select('*')
        .eq('vehicle_id', vehicleId)
        .eq('schema_version', 2)
        .in('status', ['queued', 'accepted'])
        .order('issued_at')
        .limit(20);
      const after = requestUrl.searchParams.get('after');
      if (after) query = query.gt('issued_at', after);
      const result = await query;
      if (result.error) return databaseError(result.error, requestId);
      const commands = result.data.map((command) => ({
        schemaVersion: 2,
        commandId: command.command_id,
        correlationId: command.correlation_id,
        idempotencyKey: command.idempotency_key,
        vehicleId: command.vehicle_id,
        target: { kind: command.route_job_id ? 'route_job' : 'delivery', id: command.route_job_id ?? command.delivery_id },
        type: command.type,
        issuedAt: command.issued_at,
        expiresAt: command.expires_at,
        ...(Object.keys(command.preconditions ?? {}).length ? { preconditions: command.preconditions } : {}),
        payload: command.payload
      }));
      const invalid = commands.find((command) => !validateCommand(command));
      if (invalid) return response(500, { requestId, error: { code: 'SERVER_COMMAND_SCHEMA_INVALID', message: 'Queued command failed contract validation.', retryable: false } });
      return response(200, { requestId, cursor: result.data.at(-1)?.issued_at ?? after ?? '', data: commands });
    }

    const eventMatch = path.match(/^\/api\/v1\/robot\/commands\/([0-9a-f-]+)\/events$/i);
    if (request.method === 'POST' && eventMatch) {
      const event = await readJson(request);
      if (!validateCommandEvent(event) || event.commandId !== eventMatch[1]) return schemaFailure(validateCommandEvent, requestId);
      const command = await client.from('vehicle_commands').select('command_id,vehicle_id').eq('command_id', eventMatch[1]).single();
      if (command.error || command.data.vehicle_id !== vehicleId) {
        return response(403, { requestId, error: { code: 'ROBOT_SCOPE_DENIED', message: 'Command scope denied.', retryable: false } });
      }
      const processed = await client.rpc('process_robot_command_event', {
        p_vehicle_id: vehicleId,
        p_command_id: eventMatch[1],
        p_event_id: event.eventId,
        p_event: event.event,
        p_source_sequence: event.sourceSequence,
        p_evidence: event.evidence ?? {},
        p_error_code: event.errorCode ?? null
      });
      if (processed.error) return databaseError(processed.error, requestId);
      return response(200, { requestId, data: processed.data });
    }

    if (request.method === 'POST' && path === '/api/v1/robot/telemetry') {
      const body = await readJson(request);
      if (!validateTelemetry(body)) return schemaFailure(validateTelemetry, requestId);
      if (body.vehicleId !== vehicleId) {
        return response(403, { requestId, error: { code: 'ROBOT_SCOPE_DENIED', message: 'Telemetry scope denied.', retryable: false } });
      }
      const result = await client.rpc('ingest_robot_telemetry_v2', { p_vehicle_id: vehicleId, p_envelope: body });
      if (result.error) return databaseError(result.error, requestId);
      if (result.data?.accepted === false) {
        const code = stableCodes.has(result.data.errorCode) ? result.data.errorCode : 'ROBOT_API_FAILED';
        return response(409, {
          requestId,
          error: { code, message: code, retryable: code === 'TELEMETRY_OUT_OF_ORDER' },
          data: { rawRecorded: result.data.rawRecorded === true, currentUpdated: false }
        });
      }
      return response(202, { requestId, data: result.data });
    }

    if (request.method === 'POST' && path === '/api/v1/robot/faults') {
      const body = await readJson(request);
      if (!validateRobotFault(body)) return schemaFailure(validateRobotFault, requestId);
      if (body.vehicleId !== vehicleId) {
        return response(403, { requestId, error: { code: 'ROBOT_SCOPE_DENIED', message: 'Fault scope denied.', retryable: false } });
      }
      const result = await client.rpc('record_robot_fault', { p_vehicle_id: vehicleId, p_envelope: body });
      if (result.error) return databaseError(result.error, requestId);
      return response(202, { requestId, data: result.data });
    }

    const stateMatch = path.match(/^\/api\/v1\/robot\/vehicles\/([0-9a-f-]+)\/state$/i);
    if (request.method === 'GET' && stateMatch) {
      if (stateMatch[1] !== vehicleId) return response(403, { requestId, error: { code: 'ROBOT_SCOPE_DENIED', message: 'Vehicle scope denied.', retryable: false } });
      const result = await client.from('vehicle_state_current').select('vehicle_id,boot_id,sequence,vehicle_state,connectivity,current_route_job_id,current_leg_id,observed_at,received_at').eq('vehicle_id', vehicleId).maybeSingle();
      if (result.error) return databaseError(result.error, requestId);
      return response(200, { requestId, data: result.data });
    }

    return response(404, { requestId, error: { code: 'NOT_FOUND', message: 'Robot endpoint not found.', retryable: false } });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'ROBOT_API_FAILED';
    const status = code === 'PAYLOAD_TOO_LARGE' ? 413 : code === 'CONTRACT_SCHEMA_INVALID' ? 422 : 500;
    return response(status, { requestId, error: { code, message: error instanceof Error ? error.message : 'Robot operation failed.', retryable: false } });
  }
});
