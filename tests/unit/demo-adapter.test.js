import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoAdapter } from '../../src/demo/adapter.js';

function configure(adapter) {
  adapter.authenticateGuest();
  adapter.saveDraft({
    pickupCode: 'LIBRARY',
    dropoffCode: 'ADMIN',
    recipientName: '展示收件人',
    recipientPhone: '0912345678',
    recipientEmail: 'recipient@example.com',
    itemType: 'document',
    note: ''
  });
  adapter.confirmDraft();
}

describe('deterministic demo adapter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('completes the eight-step sender and recipient journey without external services', async () => {
    const adapter = new DemoAdapter({ storage: null });
    configure(adapter);
    expect(adapter.snapshot().delivery.status).toBe('confirmed');
    adapter.startDispatch('same-key');
    await vi.runAllTimersAsync();
    expect(adapter.snapshot().delivery.status).toBe('arrived_pickup');
    adapter.requestSenderOpen('open-key');
    await vi.runAllTimersAsync();
    expect(adapter.snapshot().delivery.status).toBe('compartment_open_for_sender');
    adapter.confirmLoaded();
    await vi.runAllTimersAsync();
    expect(adapter.snapshot().delivery.status).toBe('awaiting_recipient');
    expect(adapter.redeemCredential('NDHU-4826')).toBe(true);
    await vi.runAllTimersAsync();
    expect(adapter.snapshot().delivery.status).toBe('compartment_open_for_recipient');
    adapter.confirmPickup();
    await vi.runAllTimersAsync();
    expect(adapter.snapshot().delivery.status).toBe('completed');
  });

  it('deduplicates repeated dispatch idempotency keys', () => {
    const adapter = new DemoAdapter({ storage: null });
    configure(adapter);
    adapter.startDispatch('duplicate-key');
    const version = adapter.snapshot().delivery.version;
    adapter.startDispatch('duplicate-key');
    expect(adapter.snapshot().delivery.version).toBe(version);
  });

  it('never fabricates a marker when robot is offline before dispatch', () => {
    const adapter = new DemoAdapter({ storage: null });
    configure(adapter);
    adapter.setScenario('robot-offline-before-dispatch');
    configure(adapter);
    adapter.startDispatch();
    expect(adapter.snapshot().delivery.status).toBe('confirmed');
    expect(adapter.snapshot().telemetry.position).toBeNull();
    expect(adapter.snapshot().actionError.code).toBe('ROBOT_OFFLINE');
  });

  it('locks a human credential after five invalid attempts', () => {
    const adapter = new DemoAdapter({ storage: null });
    configure(adapter);
    adapter.startDispatch();
    return vi.runAllTimersAsync().then(async () => {
      adapter.requestSenderOpen();
      await vi.runAllTimersAsync();
      adapter.confirmLoaded();
      await vi.runAllTimersAsync();
      for (let attempt = 0; attempt < 5; attempt += 1) expect(adapter.redeemCredential('WRONG')).toBe(false);
      expect(adapter.snapshot().recipientAttempt.phase).toBe('locked');
      expect(adapter.redeemCredential('NDHU 4826')).toBe(false);
    });
  });
});

