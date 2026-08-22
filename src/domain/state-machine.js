import { DomainError } from './errors.js';

export const DELIVERY_STATUSES = Object.freeze([
  'draft',
  'confirmed',
  'dispatching',
  'arrived_pickup',
  'compartment_open_for_sender',
  'loaded',
  'in_transit',
  'arrived_dropoff',
  'awaiting_recipient',
  'compartment_open_for_recipient',
  'picked_up',
  'completed',
  'cancel_requested',
  'returning_to_base',
  'cancelled',
  'delivery_failed'
]);

/** @typedef {'sender'|'recipient'|'robot'|'gateway'|'system'|'operator'} ActorType */

const transitionRules = Object.freeze({
  draft: {
    CONFIRM: { to: 'confirmed', actors: ['sender'] },
    CANCEL_DRAFT: { to: 'cancelled', actors: ['sender'] }
  },
  confirmed: {
    REQUEST_DISPATCH: { to: 'dispatching', actors: ['sender', 'system'] },
    CANCEL_UNRESERVED: { to: 'cancelled', actors: ['sender'] }
  },
  dispatching: {
    VEHICLE_ARRIVED_PICKUP: { to: 'arrived_pickup', actors: ['robot', 'gateway'] },
    REQUEST_CANCEL: { to: 'cancel_requested', actors: ['sender'] },
    TERMINAL_FAILURE: { to: 'delivery_failed', actors: ['system', 'operator'] }
  },
  arrived_pickup: {
    SENDER_OPEN_COMPLETED: { to: 'compartment_open_for_sender', actors: ['robot', 'gateway'] },
    REQUEST_CANCEL: { to: 'cancel_requested', actors: ['sender'] }
  },
  compartment_open_for_sender: {
    LOAD_CONFIRMED: { to: 'loaded', actors: ['sender', 'robot', 'operator'] },
    REQUEST_CANCEL: { to: 'cancel_requested', actors: ['sender'] }
  },
  loaded: {
    DOOR_CLOSED_AND_DEPARTED: { to: 'in_transit', actors: ['robot', 'gateway'] },
    REQUEST_CANCEL: { to: 'cancel_requested', actors: ['sender'] }
  },
  in_transit: {
    VEHICLE_ARRIVED_DROPOFF: { to: 'arrived_dropoff', actors: ['robot', 'gateway'] },
    REQUEST_CANCEL: { to: 'cancel_requested', actors: ['sender'] },
    TERMINAL_FAILURE: { to: 'delivery_failed', actors: ['system', 'operator'] }
  },
  arrived_dropoff: {
    CREDENTIALS_ACTIVE: { to: 'awaiting_recipient', actors: ['system'] }
  },
  awaiting_recipient: {
    RECIPIENT_OPEN_COMPLETED: { to: 'compartment_open_for_recipient', actors: ['robot', 'gateway'] }
  },
  compartment_open_for_recipient: {
    ITEM_REMOVED_AND_DOOR_CLOSED: { to: 'picked_up', actors: ['robot', 'operator'] }
  },
  picked_up: {
    CUSTODY_CONFIRMED: { to: 'completed', actors: ['system', 'operator'] }
  },
  cancel_requested: {
    SAFE_RETURN_SELECTED: { to: 'returning_to_base', actors: ['robot', 'operator'] },
    CANNOT_RECOVER: { to: 'delivery_failed', actors: ['system', 'operator'] }
  },
  returning_to_base: {
    ITEM_CUSTODY_RESOLVED: { to: 'cancelled', actors: ['operator', 'robot'] },
    RETURN_FAILED: { to: 'delivery_failed', actors: ['system', 'operator', 'robot'] }
  }
});

/**
 * @param {string} status
 * @param {string} event
 * @param {ActorType} actor
 */
export function nextDeliveryStatus(status, event, actor) {
  const statusRules = transitionRules[status];
  const rule = statusRules?.[event];
  if (!rule || !rule.actors.includes(actor)) {
    throw new DomainError(
      'DELIVERY_INVALID_TRANSITION',
      `狀態 ${status} 不允許 ${actor} 執行 ${event}。`
    );
  }
  return rule.to;
}

/** @param {string} status */
export function allowedEvents(status) {
  return Object.keys(transitionRules[status] ?? {});
}

/**
 * @param {Delivery} delivery
 * @param {string} event
 * @param {ActorType} actor
 * @param {Record<string, unknown>} [metadata]
 * @returns {Delivery}
 */
export function applyDeliveryEvent(delivery, event, actor, metadata = {}) {
  const to = nextDeliveryStatus(delivery.status, event, actor);
  const at = typeof metadata.at === 'string' ? metadata.at : new Date().toISOString();
  const nextVersion = delivery.version + 1;
  return {
    ...delivery,
    status: to,
    version: nextVersion,
    updatedAt: at,
    completedAt: to === 'completed' ? at : delivery.completedAt,
    terminalReason: ['cancelled', 'delivery_failed'].includes(to)
      ? String(metadata.reason ?? to)
      : delivery.terminalReason,
    history: [
      ...delivery.history,
      {
        version: nextVersion,
        from: delivery.status,
        to,
        event,
        actor,
        at,
        evidence: metadata.evidence ?? null
      }
    ]
  };
}

/**
 * @typedef {object} Delivery
 * @property {string} id
 * @property {string} publicRef
 * @property {string} status
 * @property {number} version
 * @property {string} pickupCode
 * @property {string} dropoffCode
 * @property {string} recipientName
 * @property {string} recipientPhone
 * @property {string} recipientEmail
 * @property {string} itemType
 * @property {string} note
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string|null} completedAt
 * @property {string|null} terminalReason
 * @property {Array<Record<string, unknown>>} history
 */

