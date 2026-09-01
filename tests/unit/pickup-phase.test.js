import { expect, test } from 'vitest';
import { pickupPhase } from '../../src/domain/presentation.js';

/**
 * recipientAttempt.phase only lives for one visit. Reload, switch device, or
 * open the link from the mail a second time and it is back to 'idle' — so the
 * page asked again for a code that had already been spent, and hid the confirm
 * button because the phase looked wrong. The server knows better.
 */
test('an open deck shows the confirm step even on a fresh visit', () => {
  expect(pickupPhase('compartment_open_for_recipient', 'idle')).toBe('open');
});

test('a finished pickup reads as finished however the visit started', () => {
  expect(pickupPhase('completed', 'idle')).toBe('confirmed');
  expect(pickupPhase('picked_up', 'idle')).toBe('confirming');
});

test('the server wins over a stale local phase', () => {
  // A page left open through the whole handover would otherwise keep showing
  // the step it last saw.
  expect(pickupPhase('completed', 'opening')).toBe('confirmed');
});

test('leaves the local phase alone where the status cannot say', () => {
  // Waiting for a code, or locked out after five wrong tries, are things only
  // this visit knows about.
  expect(pickupPhase('awaiting_recipient', 'idle')).toBe('idle');
  expect(pickupPhase('awaiting_recipient', 'locked')).toBe('locked');
  expect(pickupPhase('awaiting_recipient', 'opening')).toBe('opening');
});

test('falls back to idle when nothing is known', () => {
  expect(pickupPhase('awaiting_recipient', undefined)).toBe('idle');
});
