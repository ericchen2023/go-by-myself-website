import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { corsHeaders, errorResponse, json } from '../_shared/http.ts';
import { getSupabasePublishableKey, getSupabaseUrl } from '../_shared/supabase-env.ts';

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== 'POST') return errorResponse(request, requestId, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
  const authorization = request.headers.get('authorization');
  if (!authorization) return errorResponse(request, requestId, 401, 'AUTH_SESSION_EXPIRED', 'Authentication required.');

  const url = getSupabaseUrl();
  const publishableKey = getSupabasePublishableKey();
  if (!url || !publishableKey) return errorResponse(request, requestId, 503, 'ENV_CONFIG_INVALID', 'Control plane is not configured.');
  const client = createClient(url, publishableKey, { global: { headers: { Authorization: authorization } } });

  try {
    const body = await request.json();
    if (body.schemaVersion !== 1 || typeof body.intent !== 'string') {
      return errorResponse(request, requestId, 400, 'CONTRACT_INVALID', 'Invalid mutation envelope.');
    }
    let result;
    if (body.intent === 'GET_ACTIVE_DELIVERY') {
      result = await client.rpc('get_active_delivery_projection');
    } else if (body.intent === 'CREATE_AND_CONFIRM') {
      const input = body.input ?? {};
      result = await client.rpc('create_and_confirm_delivery', {
        p_pickup_code: input.pickupCode,
        p_dropoff_code: input.dropoffCode,
        p_recipient_name: input.recipientName,
        p_phone_e164: input.recipientPhone,
        p_recipient_email: input.recipientEmail || null,
        p_email_consent: Boolean(input.recipientEmail),
        p_item_type: input.itemType,
        p_note: input.note ?? '',
        p_idempotency_key: body.idempotencyKey
      });
    } else {
      result = await client.rpc('execute_delivery_intent', {
        p_delivery_id: body.deliveryId,
        p_intent: body.intent,
        p_expected_version: body.expectedVersion,
        p_idempotency_key: body.idempotencyKey
      });
    }
    if (result.error) {
      const code = String(result.error.message ?? 'DELIVERY_INTENT_FAILED').split(':')[0];
      const status = code.includes('RLS') || code.includes('AUTH') ? 403 : code.includes('CONFLICT') ? 409 : 400;
      return errorResponse(request, requestId, status, code, '操作未完成，請依 request reference 安全重試。', status >= 500 || status === 409);
    }
    return json(request, 200, { requestId, data: result.data });
  } catch {
    return errorResponse(request, requestId, 400, 'CONTRACT_INVALID', 'Invalid JSON request.');
  }
});
