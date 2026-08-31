import { beforeEach, expect, test, vi } from 'vitest';

const signInWithOAuth = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { signInWithOAuth } })
}));

vi.mock('../../src/config/runtime.js', () => ({
  runtimeConfig: {
    appMode: 'production',
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: 'sb_publishable_test',
    googleAuthEnabled: true
  },
  assertProductionBrowserConfig: () => {}
}));

const { ProductionAdapter } = await import('../../src/production/adapter.js');

beforeEach(() => {
  signInWithOAuth.mockReset();
  signInWithOAuth.mockResolvedValue({ error: null });
  window.history.replaceState({}, '', '/');
});

test('Google OAuth accepts any Google account without a hosted-domain hint', async () => {
  const adapter = new ProductionAdapter();

  await adapter.signInWithGoogle();

  expect(signInWithOAuth).toHaveBeenCalledWith({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/`,
      queryParams: { prompt: 'select_account' }
    }
  });
});
