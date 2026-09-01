import { expect, test, vi } from 'vitest';
import { ProductionAdapter } from '../../src/production/adapter.js';

/**
 * A delivery that ends stops being returned by GET_ACTIVE_DELIVERY, which is
 * defined to exclude terminal states. Clearing the screen at that point threw
 * away the very thing the sender was waiting to see, and took the recipient's
 * pickup page down with it — that page identifies itself by the same delivery.
 * So the ending is fetched rather than assumed, and what happens next is left
 * to whoever is reading.
 */
function adapterShowing(replies) {
  const adapter = new ProductionAdapter();
  const invoke = vi.fn(async () => ({ data: { data: replies.shift() ?? null }, error: null }));
  adapter.supabase = /** @type {any} */ ({ removeChannel: vi.fn(async () => {}), functions: { invoke } });
  adapter.channel = /** @type {any} */ ({ topic: 'delivery:old' });
  adapter.state = {
    ...adapter.state,
    wizardStep: 5,
    delivery: { id: 'old', version: 7, status: 'in_transit', publicRef: 'pub-1' },
    telemetry: { ...adapter.state.telemetry, projectionVersion: 3 }
  };
  return adapter;
}

test('shows how the delivery ended instead of clearing it away', async () => {
  // Two empty reads to confirm it is over, then the delivery fetched by id.
  const adapter = adapterShowing([null, null, { delivery: { id: 'old', version: 9, status: 'completed', publicRef: 'pub-1' } }]);

  await adapter.refreshActiveDeliverySnapshot();

  expect(adapter.state.delivery?.status).toBe('completed');
  expect(adapter.state.wizardStep).toBe(5);
});

test('keeps the last state on screen when the ending cannot be fetched', async () => {
  const adapter = adapterShowing([null, null]);
  adapter.supabase.functions.invoke = /** @type {any} */ (vi.fn(async () => {
    throw new Error('offline');
  }));

  await adapter.refreshActiveDeliverySnapshot();

  // Nothing was learned, but the delivery is still there to look at.
  expect(adapter.state.delivery?.id).toBe('old');
});

test('keeps showing the delivery while the server still has one', async () => {
  const adapter = adapterShowing([{ delivery: { id: 'old', version: 8, status: 'in_transit' }, telemetry: { projectionVersion: 4 } }]);

  await adapter.refreshActiveDeliverySnapshot();

  expect(adapter.state.delivery?.version).toBe(8);
});

test('does nothing when there was no delivery to begin with', async () => {
  const adapter = adapterShowing([null]);
  adapter.state = { ...adapter.state, delivery: null, wizardStep: 2 };

  await adapter.refreshActiveDeliverySnapshot();

  expect(adapter.state.wizardStep).toBe(2);
});

test('keeps the delivery when a second read disagrees with the first', async () => {
  const adapter = adapterShowing([null, { delivery: { id: 'old', version: 7, status: 'in_transit' } }]);

  await adapter.refreshActiveDeliverySnapshot();

  expect(adapter.state.delivery?.status).toBe('in_transit');
});
