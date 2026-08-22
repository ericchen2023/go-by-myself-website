import { describe, expect, it } from 'vitest';
import { deliveryStatusCopy, notificationCopy, stepForStatus } from '../../src/domain/presentation.js';

describe('truthful UI projection', () => {
  it('keeps arrival and recipient pickup in step 7', () => {
    expect(stepForStatus('arrived_dropoff')).toBe(7);
    expect(stepForStatus('awaiting_recipient')).toBe(7);
    expect(stepForStatus('picked_up')).toBe(7);
    expect(stepForStatus('completed')).toBe(8);
  });

  it('does not claim provider delivery at accepted state', () => {
    expect(notificationCopy('accepted')).toBe('通知服務已接受');
    expect(notificationCopy('delivered')).toBe('通知已送達');
    expect(notificationCopy('unconfigured')).toMatch(/未設定/);
  });

  it('uses connectivity as an overlay instead of replacing lifecycle status', () => {
    const copy = deliveryStatusCopy('in_transit', { connectivity: 'offline' });
    expect(copy.title).toMatch(/離線/);
    expect(copy.detail).toMatch(/投遞狀態並未/);
  });
});

