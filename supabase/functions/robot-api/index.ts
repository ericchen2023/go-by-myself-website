import { createClient } from 'npm:@supabase/supabase-js@2';

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
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
  });
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const expectedToken = Deno.env.get('ROBOT_GATEWAY_TOKEN') ?? '';
  const authorization = request.headers.get('authorization') ?? '';
  const clientId = request.headers.get('x-robot-client-id') ?? '';
  if (!expectedToken || !clientId || !equal(await digest(authorization), await digest(`Bearer ${expectedToken}`))) {
    return response(401, { requestId, error: { code: 'ROBOT_IDENTITY_INVALID', message: 'Robot identity rejected.', retryable: false } });
  }
  const url = Deno.env.get('SUPABASE_URL');
  const secretKey = Deno.env.get('SUPABASE_SECRET_KEY');
  const vehicleId = Deno.env.get(`ROBOT_${clientId.toUpperCase().replaceAll('-', '_')}_VEHICLE_ID`);
  if (!url || !secretKey || !vehicleId) return response(503, { requestId, error: { code: 'ENV_CONFIG_INVALID', message: 'Robot scope is not configured.', retryable: false } });
  const client = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const path = new URL(request.url).pathname.replace(/^\/robot-api/, '');

  try {
    if (request.method === 'GET' && path === '/api/v1/robot/commands') {
      const requestedVehicle = new URL(request.url).searchParams.get('vehicleId');
      if (requestedVehicle !== vehicleId) return response(403, { requestId, error: { code: 'ROBOT_SCOPE_DENIED', message: 'Vehicle scope denied.', retryable: false } });
      const result = await client.from('vehicle_commands').select('*').eq('vehicle_id', vehicleId).in('status', ['queued', 'accepted']).order('issued_at').limit(20);
      if (result.error) throw result.error;
      const commands = result.data.map((command) => ({
        schemaVersion: 1,
        commandId: command.command_id,
        correlationId: command.correlation_id,
        idempotencyKey: command.idempotency_key,
        vehicleId: command.vehicle_id,
        deliveryId: command.delivery_id,
        type: command.type,
        issuedAt: command.issued_at,
        expiresAt: command.expires_at,
        expectedVehicleState: command.expected_vehicle_state,
        payload: command.payload
      }));
      return response(200, { requestId, cursor: result.data.at(-1)?.issued_at ?? '', data: commands });
    }
    const eventMatch = path.match(/^\/api\/v1\/robot\/commands\/([0-9a-f-]+)\/events$/i);
    if (request.method === 'POST' && eventMatch) {
      const event = await request.json();
      const command = await client.from('vehicle_commands').select('command_id,vehicle_id').eq('command_id', eventMatch[1]).single();
      if (command.error || command.data.vehicle_id !== vehicleId) return response(403, { requestId, error: { code: 'ROBOT_SCOPE_DENIED', message: 'Command scope denied.', retryable: false } });
      const processed = await client.rpc('process_robot_command_event', {
        p_vehicle_id: vehicleId,
        p_command_id: eventMatch[1],
        p_event_id: event.eventId,
        p_event: event.event,
        p_source_sequence: event.sourceSequence,
        p_evidence: event.evidence ?? {},
        p_error_code: event.errorCode ?? null
      });
      if (processed.error) throw processed.error;
      return response(200, { requestId, data: processed.data });
    }
    if (request.method === 'POST' && path === '/api/v1/robot/telemetry') {
      const body = await request.json();
      if (body.schemaVersion !== 1 || body.vehicleId !== vehicleId) return response(403, { requestId, error: { code: 'ROBOT_SCOPE_DENIED', message: 'Telemetry scope denied.', retryable: false } });
      const row = { vehicle_id: vehicleId, boot_id: body.bootId, sequence: body.sequence, message_id: body.messageId, frame_id: body.pose.frameId, pose_x: body.pose.x, pose_y: body.pose.y, heading: body.pose.heading, speed: body.speed, battery: body.battery, quality: body.quality, observed_at: body.observedAt, received_at: new Date().toISOString() };
      const result = await client.from('vehicle_telemetry').insert(row);
      if (result.error && result.error.code !== '23505') throw result.error;
      await client.from('vehicle_state_current').upsert({
        vehicle_id: vehicleId,
        boot_id: body.bootId,
        sequence: body.sequence,
        frame_id: body.pose.frameId,
        pose_x: body.pose.x,
        pose_y: body.pose.y,
        heading: body.pose.heading,
        battery: body.battery,
        connectivity: 'online',
        observed_at: body.observedAt,
        received_at: new Date().toISOString()
      }, { onConflict: 'vehicle_id' });
      return response(202, { requestId, data: { accepted: true } });
    }
    if (request.method === 'POST' && path === '/api/v1/robot/faults') {
      const body = await request.json();
      if (body.vehicleId !== vehicleId) return response(403, { requestId, error: { code: 'ROBOT_SCOPE_DENIED', message: 'Fault scope denied.', retryable: false } });
      const result = await client.from('robot_faults').insert({ vehicle_id: vehicleId, delivery_id: body.deliveryId ?? null, type: body.type, severity: body.severity, safe_evidence: body.evidence ?? {}, observed_at: body.observedAt });
      if (result.error) throw result.error;
      return response(202, { requestId, data: { accepted: true } });
    }
    return response(404, { requestId, error: { code: 'NOT_FOUND', message: 'Robot endpoint not found.', retryable: false } });
  } catch {
    return response(500, { requestId, error: { code: 'ROBOT_API_FAILED', message: 'Robot operation failed.', retryable: true } });
  }
});
