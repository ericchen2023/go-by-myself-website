const configuredOrigin = Deno.env.get('APP_ORIGIN') ?? 'http://127.0.0.1:4173';

export function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? '';
  return {
    'access-control-allow-origin': origin === configuredOrigin ? origin : configuredOrigin,
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'vary': 'Origin',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  };
}

export function json(request: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'content-type': 'application/json; charset=utf-8' }
  });
}

export function errorResponse(request: Request, requestId: string, status: number, code: string, message: string, retryable = false) {
  return json(request, status, { requestId, error: { code, message, retryable } });
}

