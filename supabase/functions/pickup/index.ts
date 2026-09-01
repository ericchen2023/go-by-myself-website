import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { corsHeaders, errorResponse, json } from '../_shared/http.ts';
import { getSupabaseSecretKey, getSupabaseUrl } from '../_shared/supabase-env.ts';

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== 'POST') return errorResponse(request, requestId, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
  const url = getSupabaseUrl();
  const secretKey = getSupabaseSecretKey();
  if (!url || !secretKey) return errorResponse(request, requestId, 503, 'ENV_CONFIG_INVALID', 'Pickup service is not configured.');

  try {
    const body = await request.json();
    if (body.schemaVersion !== 1 || (!body.publicRef && body.intent !== 'RESOLVE_PICKUP_REF')) {
      return errorResponse(request, requestId, 400, 'PICKUP_CREDENTIAL_INVALID', '取件資訊無效或已失效。');
    }
    const client = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    if (body.intent === 'GET_PICKUP_CONTEXT') {
      const context = await client.rpc('get_pickup_context', { p_public_ref: body.publicRef });
      if (context.error || !context.data) return errorResponse(request, requestId, 404, 'PICKUP_CONTEXT_UNAVAILABLE', '取件資訊無效、未準備或已失效。');
      return json(request, 200, { requestId, data: context.data });
    }
    if (body.intent === 'RESOLVE_PICKUP_REF') {
      // 代號不是秘密，但一個一個試也不該便宜 —— 沿用取件碼那份每日額度，
      // 所以這裡同樣要先算出當日的 IP 範圍雜湊。
      const pepper = Deno.env.get('CREDENTIAL_PEPPER_V1');
      if (!pepper) return errorResponse(request, requestId, 503, 'ENV_CONFIG_INVALID', 'Pickup service is not configured.');
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
      const rotation = new Date().toISOString().slice(0, 10);
      const rateDigest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${rotation}|${forwardedFor}`));
      const resolved = await client.rpc('resolve_pickup_ref', {
        p_pickup_ref: String(body.pickupRef ?? ''),
        p_rate_scope: `\\x${hex(rateDigest)}`
      });
      // 查無此代號與尚未可取件回同一種錯誤：代號存不存在本身也是資訊。
      if (resolved.error || !resolved.data?.publicRef) {
        return errorResponse(request, requestId, 400, 'PICKUP_REF_INVALID', '取件代號無效，或這筆投遞還不能取件。');
      }
      return json(request, 200, { requestId, data: resolved.data });
    }
    if (body.intent === 'CONFIRM_PICKUP') {
      // 這台車沒有艙門，沒有取物感測器可以等 —— 由收件人自己確認，
      // 資料庫那邊會拒絕替有艙門的車做同樣的事。
      const confirmed = await client.rpc('confirm_recipient_pickup', {
        p_public_ref: body.publicRef,
        p_attempt_id: body.idempotencyKey ?? crypto.randomUUID()
      });
      if (confirmed.error) {
        const code = String(confirmed.error.message ?? 'DELIVERY_INVALID_TRANSITION').split(':')[0];
        return errorResponse(request, requestId, 400, code, '取件確認未完成，請重新整理後再試。');
      }
      return json(request, 200, { requestId, data: confirmed.data });
    }
    if (body.intent !== 'REDEEM_PICKUP_CREDENTIAL' || !body.code) {
      return errorResponse(request, requestId, 400, 'PICKUP_CREDENTIAL_INVALID', '取件資訊無效或已失效。');
    }
    const pepper = Deno.env.get('CREDENTIAL_PEPPER_V1');
    if (!pepper) return errorResponse(request, requestId, 503, 'ENV_CONFIG_INVALID', 'Pickup credential verifier is not configured.');
    const normalized = String(body.code).toUpperCase().replace(/[\s-]/g, '');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(normalized));
    const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const rotation = new Date().toISOString().slice(0, 10);
    const rateDigest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${rotation}|${forwardedFor}`));
    const result = await client.rpc('redeem_pickup_credential', {
      p_public_ref: body.publicRef,
      p_digest: `\\x${hex(digest)}`,
      p_attempt_id: body.idempotencyKey ?? crypto.randomUUID(),
      p_rate_scope: `\\x${hex(rateDigest)}`
    });
    if (result.error || !result.data?.authorized) return errorResponse(request, requestId, 400, 'PICKUP_CREDENTIAL_INVALID', '取件資訊無效或已失效。');
    return json(request, 200, { requestId, data: result.data });
  } catch {
    return errorResponse(request, requestId, 400, 'PICKUP_CREDENTIAL_INVALID', '取件資訊無效或已失效。');
  }
});
