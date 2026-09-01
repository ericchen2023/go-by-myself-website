import { expect, test } from 'vitest';
import { recipientNotice } from '../../src/domain/presentation.js';

/**
 * The pickup code is the recipient's key. Routing it through the sender means
 * the sender could retrieve the item themselves and have it recorded as a
 * recipient pickup — so the sender sees only whether the mail went out, and
 * the manual relay is offered only when there is no other way.
 */
test('tells the sender the code went out, and where, without showing it', () => {
  const notice = recipientNotice({ state: 'accepted', channel: 'email', maskedDestination: 'c***@gmail.com' });

  expect(notice.sent).toBe(true);
  expect(notice.canReveal).toBe(false);
  expect(notice.message).toContain('c***@gmail.com');
});

test('offers the manual relay only once the mail has actually failed', () => {
  expect(recipientNotice({ state: 'failed' }).canReveal).toBe(true);
  expect(recipientNotice({ state: 'unconfigured' }).canReveal).toBe(true);
});

test('a mail still in flight is not a reason to hand the code over', () => {
  for (const state of ['queued', 'sending', 'retrying', 'delivered']) {
    expect(recipientNotice({ state }).canReveal).toBe(false);
  }
});

test('waits quietly while the arrival has not produced a notification yet', () => {
  const notice = recipientNotice(null, 'arrived_dropoff');

  expect(notice.sent).toBe(false);
  expect(notice.canReveal).toBe(false);
  expect(notice.message).toContain('正在把取件碼寄給收件人');
});

test('stops waiting once the handover happened with nothing recorded', () => {
  // Waiting for a mail that was never attempted is another state with no exit —
  // and a delivery already opened for the recipient has one recoverable path.
  const notice = recipientNotice(null, 'awaiting_recipient');

  expect(notice.canReveal).toBe(true);
  expect(notice.message).toContain('沒有取件碼的通知紀錄');
});

test('separates "no mail service" from "recipient gave no address"', () => {
  const noService = recipientNotice({ state: 'unconfigured', maskedDestination: 'c***@gmail.com' });
  const noAddress = recipientNotice({ state: 'unconfigured', maskedDestination: '(未提供信箱)' });

  expect(noService.message).toContain('沒有設定寄信服務');
  expect(noAddress.message).toContain('收件人沒有可用的信箱');
  expect(noService.canReveal && noAddress.canReveal).toBe(true);
});
