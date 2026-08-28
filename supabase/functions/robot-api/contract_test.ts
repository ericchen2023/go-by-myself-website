import fixtures from '../../../contracts/fixtures.json' with { type: 'json' };
import invalidFixtures from '../../../contracts/invalid-fixtures.json' with { type: 'json' };
import { schemaErrors, validateCommand, validateCommandEvent, validateTelemetry } from './contract.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('Edge runtime accepts canonical command fixtures', () => {
  for (const [index, command] of fixtures.commands.entries()) {
    assert(validateCommand(command), `command fixture ${index}: ${schemaErrors(validateCommand)}`);
  }
});

Deno.test('Edge runtime accepts canonical telemetry fixtures', () => {
  for (const [index, telemetry] of fixtures.telemetry.entries()) {
    assert(validateTelemetry(telemetry), `telemetry fixture ${index}: ${schemaErrors(validateTelemetry)}`);
  }
});

Deno.test('Edge runtime rejects every negative fixture', () => {
  for (const fixture of invalidFixtures.commands) {
    assert(!validateCommand(fixture.value), `invalid command passed: ${fixture.name}`);
  }
  for (const fixture of invalidFixtures.telemetry) {
    assert(!validateTelemetry(fixture.value), `invalid telemetry passed: ${fixture.name}`);
  }
});

Deno.test('Edge runtime distinguishes accepted and completed command events', () => {
  const base = {
    schemaVersion: 2,
    commandId: 'a0000000-0000-4000-8000-000000000001',
    eventId: 'a0000000-0000-4000-8000-000000000099',
    observedAt: '2026-08-22T02:00:02.000Z',
    sourceSequence: 2,
    evidence: {}
  };
  assert(validateCommandEvent({ ...base, event: 'accepted' }), schemaErrors(validateCommandEvent));
  assert(validateCommandEvent({ ...base, event: 'completed' }), schemaErrors(validateCommandEvent));
  assert(!validateCommandEvent({ ...base, event: 'done' }), 'unknown physical completion event passed');
});
