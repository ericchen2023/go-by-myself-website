import { expect, test, vi } from 'vitest';
import { pickupOpenAction } from '../../src/production/mode-presentation.js';

/**
 * A vehicle with a door reports the pickup itself, and the page must not speak
 * for a sensor. GBM-01 has no door, so that report never comes — without a
 * button the recipient reaches a page they cannot leave, which is what happened.
 */
test('a doorless vehicle gives the recipient something to press', () => {
  const confirm = vi.fn();
  const section = pickupOpenAction(confirm, { hasCompartment: false });
  const button = section.querySelector('button');

  expect(button?.textContent).toBe('已關閉艙門');
  button?.click();
  expect(confirm).toHaveBeenCalledOnce();
});

test('a vehicle with a door still waits for its own evidence', () => {
  const section = pickupOpenAction(vi.fn(), { hasCompartment: true });

  expect(section.querySelector('button')).toBeNull();
  expect(section.textContent).toContain('網頁不能自行把投遞標示為完成');
});

test('says nothing about a door the vehicle does not have', () => {
  const doorless = pickupOpenAction(vi.fn(), { hasCompartment: false });

  expect(doorless.textContent).toContain('車上的置物區');
  expect(doorless.textContent).not.toContain('艙內沒有遺留物');
});

test('waits for the vehicle when nothing is known about it', () => {
  // Absent capability must not be read as "no door" — that would let the page
  // declare a pickup the robot alone can witness.
  expect(pickupOpenAction(vi.fn(), {}).querySelector('button')).toBeNull();
});
