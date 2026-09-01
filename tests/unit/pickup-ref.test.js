import { expect, test, vi } from 'vitest';
import { ProductionAdapter } from '../../src/production/adapter.js';

/**
 * The recipient page is addressed by a uuid nobody can type, so a recipient
 * whose mail went missing had no way in at all. The typed reference is that way
 * in — an identifier, not a secret: the pickup code is still what authorises.
 */
function adapterWithPickup(response) {
  const adapter = new ProductionAdapter();
  adapter.supabase = /** @type {any} */ ({
    functions: { invoke: vi.fn(async () => response) }
  });
  return adapter;
}

test('normalises what someone typed or pasted before sending it', async () => {
  const adapter = adapterWithPickup({ data: { data: { publicRef: 'ref-1' } }, error: null });

  await adapter.resolvePickupRef(' gbm-7k3 q ');

  const invoke = /** @type {any} */ (adapter.supabase.functions.invoke);
  const [, options] = invoke.mock.calls[0];
  expect(options.body.pickupRef).toBe('GBM7K3Q');
});

test('hands back the reference the recipient page needs', async () => {
  const adapter = adapterWithPickup({ data: { data: { publicRef: 'ref-1' } }, error: null });

  await expect(adapter.resolvePickupRef('GBM7K3Q')).resolves.toBe('ref-1');
});

test('says nothing more than "invalid" when the reference does not resolve', async () => {
  const adapter = adapterWithPickup({ data: null, error: { message: 'PICKUP_REF_INVALID' } });

  // Whether a reference exists is itself information, so the failure carries
  // the same message as one that is simply not ready for pickup.
  await expect(adapter.resolvePickupRef('ZZZZZZ')).rejects.toThrow('取件資訊無效或已失效。');
});
