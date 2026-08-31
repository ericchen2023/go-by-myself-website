import { describe, expect, test } from 'vitest';
import { vercelProtectionHeaders } from '../../scripts/vercel-protection.mjs';

describe('Vercel deployment protection headers', () => {
  test('omits the header when no bypass secret is configured', () => {
    expect(vercelProtectionHeaders(undefined)).toEqual({});
    expect(vercelProtectionHeaders('   ')).toEqual({});
  });

  test('sends the bypass secret only through the documented header', () => {
    expect(vercelProtectionHeaders('test-bypass-secret')).toEqual({
      'x-vercel-protection-bypass': 'test-bypass-secret'
    });
  });
});
