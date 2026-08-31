import { expect, test, vi } from 'vitest';
import { ProductionAdapter } from '../../src/production/adapter.js';

/**
 * A delivery that ends leaves the page nothing newer to compare against:
 * GET_ACTIVE_DELIVERY stops returning it, so a version check can never fire and
 * the reader is left looking at a finished delivery with no way back to the
 * form. These hold the path that gets them back.
 */
function adapterShowing(activeProjection) {
  const adapter = new ProductionAdapter();
  // A stub standing in for the Supabase client: only the two calls this path
  // makes are needed, so it is cast rather than reconstructed.
  adapter.supabase = /** @type {any} */ ({
    removeChannel: vi.fn(async () => {}),
    functions: { invoke: vi.fn(async () => ({ data: { data: activeProjection }, error: null })) }
  });
  adapter.channel = /** @type {any} */ ({ topic: 'delivery:old' });
  adapter.state = {
    ...adapter.state,
    wizardStep: 5,
    delivery: { id: 'old', version: 7, status: 'cancel_requested', pickupCode: 'HSS2', dropoffCode: 'LIBRARY' },
    telemetry: { ...adapter.state.telemetry, connectivity: 'offline', projectionVersion: 3 }
  };
  return adapter;
}

test('returns to a blank form once the server has no delivery in flight', async () => {
  const adapter = adapterShowing(null);

  await adapter.refreshActiveDeliverySnapshot();

  expect(adapter.state.delivery).toBeNull();
  expect(adapter.state.wizardStep).toBe(1);
  // The finished delivery's channel is let go rather than left subscribed.
  expect(adapter.channel).toBeNull();
  expect(adapter.supabase.removeChannel).toHaveBeenCalled();
});

test('keeps showing the delivery while the server still has one', async () => {
  const adapter = adapterShowing({
    delivery: { id: 'old', version: 8, status: 'cancel_requested' },
    telemetry: { connectivity: 'online', projectionVersion: 4 }
  });

  await adapter.refreshActiveDeliverySnapshot();

  expect(adapter.state.delivery?.version).toBe(8);
  expect(adapter.state.wizardStep).toBe(5);
});

test('leaves a blank form alone when there is nothing to recover from', async () => {
  const adapter = adapterShowing(null);
  adapter.state = { ...adapter.state, delivery: null, wizardStep: 2 };

  await adapter.refreshActiveDeliverySnapshot();

  expect(adapter.state.wizardStep).toBe(2);
  expect(adapter.supabase.removeChannel).not.toHaveBeenCalled();
});

test('keeps the delivery when a second read disagrees with the first', async () => {
  const adapter = adapterShowing(null);
  const delivery = { id: 'old', version: 7, status: 'in_transit' };
  let reads = 0;
  adapter.supabase.functions.invoke = /** @type {any} */ (vi.fn(async () => {
    reads += 1;
    return { data: { data: reads === 1 ? null : { delivery } }, error: null };
  }));

  await adapter.refreshActiveDeliverySnapshot();

  expect(adapter.state.delivery?.id).toBe('old');
  expect(adapter.state.wizardStep).toBe(5);
  expect(adapter.channel).not.toBeNull();
});
