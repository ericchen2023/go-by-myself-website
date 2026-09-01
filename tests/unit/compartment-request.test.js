import { expect, test } from 'vitest';
import { compartmentRequest } from '../../src/domain/presentation.js';

/**
 * GBM-01 has no compartment hardware, so it rejects every OPEN_COMPARTMENT with
 * COMMAND_TYPE_UNSUPPORTED. The screen used to show nothing at all and re-arm
 * the button, and a sender pressed it four times in 1.5 seconds. The refusal
 * has to reach them in words.
 */
test('says the vehicle has no compartment rather than re-arming the button', () => {
  const request = compartmentRequest({ type: 'OPEN_COMPARTMENT', state: 'rejected', errorCode: 'COMMAND_TYPE_UNSUPPORTED' });

  expect(request.phase).toBe('refused');
  expect(request.message).toContain('沒有可遙控的置物艙');
});

test('names the code even for a refusal it has no wording for', () => {
  const request = compartmentRequest({ type: 'OPEN_COMPARTMENT', state: 'rejected', errorCode: 'SOMETHING_NEW' });

  expect(request.phase).toBe('refused');
  expect(request.message).toContain('SOMETHING_NEW');
});

test('treats an expired command as a refusal, not as still waiting', () => {
  const request = compartmentRequest({ type: 'OPEN_COMPARTMENT', state: 'expired', errorCode: null });

  expect(request.phase).toBe('refused');
  expect(request.message).toContain('逾時');
});

test('waits while the command is still with the vehicle', () => {
  expect(compartmentRequest({ type: 'OPEN_COMPARTMENT', state: 'queued' }).phase).toBe('waiting');
  expect(compartmentRequest({ type: 'OPEN_COMPARTMENT', state: 'accepted' }).phase).toBe('waiting');
});

test('ignores commands that are not about the compartment', () => {
  expect(compartmentRequest({ type: 'DISPATCH', state: 'rejected', errorCode: 'ROBOT_STATE_INVALID' }).phase).toBe('idle');
  expect(compartmentRequest(null).phase).toBe('idle');
  expect(compartmentRequest().phase).toBe('idle');
});

test('a completed open leaves nothing to say', () => {
  expect(compartmentRequest({ type: 'OPEN_COMPARTMENT', state: 'completed' }).phase).toBe('idle');
});
