import { expect, test, vi } from 'vitest';
import { ProductionAdapter } from '../../src/production/adapter.js';

/**
 * One browser profile holds one Supabase session, shared by every tab — that
 * part is how the web works. What must not follow is the previous account's
 * delivery staying on screen: recipient name, stops, progress, and a realtime
 * channel still taking updates, all belonging to someone else.
 */
function signedInAdapterShowing(activeForNextAccount) {
  const adapter = new ProductionAdapter();
  adapter.supabase = /** @type {any} */ ({
    removeChannel: vi.fn(async () => {}),
    functions: { invoke: vi.fn(async () => ({ data: { data: activeForNextAccount }, error: null })) }
  });
  adapter.channel = /** @type {any} */ ({ topic: 'delivery:someone-else' });
  adapter.state = {
    ...adapter.state,
    session: { id: 'user-a', displayName: 'A', email: 'a@example.com', assurance: 'google_hd', roles: [] },
    wizardStep: 5,
    delivery: { id: 'a-delivery', version: 3, status: 'in_transit', publicRef: 'pub-a' },
    pickupCode: 'ABCD2345'
  };
  return adapter;
}

test('an account with no delivery does not inherit the last one', async () => {
  const adapter = signedInAdapterShowing(null);

  await adapter.loadActiveDeliveryForTest();

  expect(adapter.state.delivery).toBeNull();
  expect(adapter.state.pickupCode).toBeNull();
});

test('lets go of the channel that was feeding the other delivery', async () => {
  const adapter = signedInAdapterShowing(null);

  await adapter.loadActiveDeliveryForTest();

  expect(adapter.channel).toBeNull();
  expect(adapter.supabase.removeChannel).toHaveBeenCalled();
});

test('a code shown to one sender is not left on screen for the next', async () => {
  const adapter = signedInAdapterShowing(null);

  await adapter.loadActiveDeliveryForTest();

  expect(adapter.state.pickupCode).toBeNull();
});
