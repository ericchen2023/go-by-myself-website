import { describe, expect, it } from 'vitest';
import { applyDeliveryEvent, nextDeliveryStatus } from '../../src/domain/state-machine.js';

function delivery(status = 'draft') {
  return {
    id: 'delivery-test',
    publicRef: 'public-test',
    status,
    version: 1,
    pickupCode: 'LIBRARY',
    dropoffCode: 'ADMIN',
    recipientName: '測試收件人',
    recipientPhone: '+886912345678',
    recipientEmail: 'recipient@example.com',
    itemType: 'document',
    note: '',
    createdAt: '2026-08-22T02:00:00.000Z',
    updatedAt: '2026-08-22T02:00:00.000Z',
    completedAt: null,
    terminalReason: null,
    history: []
  };
}

describe('delivery state machine', () => {
  it('requires the complete custody chain before completed', () => {
    const sequence = [
      ['CONFIRM', 'sender'],
      ['REQUEST_DISPATCH', 'sender'],
      ['VEHICLE_ARRIVED_PICKUP', 'gateway'],
      ['SENDER_OPEN_COMPLETED', 'gateway'],
      ['LOAD_CONFIRMED', 'robot'],
      ['DOOR_CLOSED_AND_DEPARTED', 'gateway'],
      ['VEHICLE_ARRIVED_DROPOFF', 'gateway'],
      ['CREDENTIALS_ACTIVE', 'system'],
      ['RECIPIENT_OPEN_COMPLETED', 'gateway'],
      ['ITEM_REMOVED_AND_DOOR_CLOSED', 'robot'],
      ['CUSTODY_CONFIRMED', 'system']
    ];
    const result = sequence.reduce((current, [event, actor], index) => applyDeliveryEvent(current, event, /** @type {any} */ (actor), { at: `2026-08-22T02:00:${String(index + 1).padStart(2, '0')}.000Z` }), delivery());
    expect(result.status).toBe('completed');
    expect(result.version).toBe(12);
    expect(result.history).toHaveLength(11);
  });

  it('does not treat arrival as completion', () => {
    expect(nextDeliveryStatus('in_transit', 'VEHICLE_ARRIVED_DROPOFF', 'gateway')).toBe('arrived_dropoff');
    expect(() => nextDeliveryStatus('arrived_dropoff', 'CUSTODY_CONFIRMED', 'system')).toThrowError(/不允許/);
  });

  it('rejects browser actors that attempt robot facts', () => {
    expect(() => nextDeliveryStatus('dispatching', 'VEHICLE_ARRIVED_PICKUP', 'sender')).toThrowError(/DELIVERY|不允許/);
    expect(() => nextDeliveryStatus('awaiting_recipient', 'RECIPIENT_OPEN_COMPLETED', 'recipient')).toThrowError(/不允許/);
  });

  it('models moving cancellation as a request and safe return', () => {
    const requested = applyDeliveryEvent(delivery('in_transit'), 'REQUEST_CANCEL', 'sender');
    const returning = applyDeliveryEvent(requested, 'SAFE_RETURN_SELECTED', 'operator');
    const cancelled = applyDeliveryEvent(returning, 'ITEM_CUSTODY_RESOLVED', 'operator');
    expect(requested.status).toBe('cancel_requested');
    expect(returning.status).toBe('returning_to_base');
    expect(cancelled.status).toBe('cancelled');
  });
});
