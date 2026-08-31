import { expect, test } from 'vitest';
import { domainErrorFrom, edgeErrorEnvelope } from '../../src/production/adapter.js';

const FALLBACK = Object.freeze({
  code: 'DELIVERY_INTENT_FAILED',
  message: '投遞操作未完成，請依 request reference 安全重試。',
  retryable: true
});

/** Mirrors supabase-js FunctionsHttpError, whose `context` is the raw Response. */
function functionsHttpError(body, { status = 400 } = {}) {
  return Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    context: new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' }
    })
  });
}

test('reports the code the Edge Function actually returned', async () => {
  const error = functionsHttpError({
    requestId: '2f1c0f2e-0f5c-4a3f-9c1a-2d5f0f4c8a11',
    error: { code: 'VEHICLE_UNAVAILABLE', message: '目前沒有可派遣的車輛。', retryable: false }
  });

  const domainError = domainErrorFrom(await edgeErrorEnvelope(error), FALLBACK);

  expect(domainError.code).toBe('VEHICLE_UNAVAILABLE');
  expect(domainError.message).toContain('目前沒有可派遣的車輛。');
  expect(domainError.message).toContain('2f1c0f2e-0f5c-4a3f-9c1a-2d5f0f4c8a11');
  expect(domainError.retryable).toBe(false);
});

test('leaves the response body readable for any other consumer', async () => {
  const error = functionsHttpError({ requestId: 'r-1', error: { code: 'DELIVERY_INVALID_TRANSITION' } });

  await edgeErrorEnvelope(error);

  await expect(error.context.json()).resolves.toMatchObject({ requestId: 'r-1' });
});

test('falls back when the transport failed before any response', async () => {
  const domainError = domainErrorFrom(await edgeErrorEnvelope(new Error('network down')), FALLBACK);

  expect(domainError.code).toBe('DELIVERY_INTENT_FAILED');
  expect(domainError.message).toBe(FALLBACK.message);
  expect(domainError.retryable).toBe(true);
});

test('falls back when the response is not JSON', async () => {
  const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    context: new Response('<html>gateway timeout</html>', { status: 504 })
  });

  const domainError = domainErrorFrom(await edgeErrorEnvelope(error), FALLBACK);

  expect(domainError.code).toBe('DELIVERY_INTENT_FAILED');
});

test('falls back when the envelope carries no usable code', async () => {
  const withoutCode = functionsHttpError({ requestId: 'r-2', error: { message: 'nope' } });
  const withEmptyCode = functionsHttpError({ error: { code: '' } });

  expect(domainErrorFrom(await edgeErrorEnvelope(withoutCode), FALLBACK).code).toBe('DELIVERY_INTENT_FAILED');
  expect(domainErrorFrom(await edgeErrorEnvelope(withEmptyCode), FALLBACK).code).toBe('DELIVERY_INTENT_FAILED');
});

test('keeps the fallback retryable flag when the envelope omits it', async () => {
  const error = functionsHttpError({ error: { code: 'DELIVERY_INVALID_TRANSITION', message: '目前狀態不允許這個操作。' } });

  const domainError = domainErrorFrom(await edgeErrorEnvelope(error), FALLBACK);

  expect(domainError.code).toBe('DELIVERY_INVALID_TRANSITION');
  expect(domainError.retryable).toBe(true);
});
