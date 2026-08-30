import { getSupabasePublishableKey, getSupabaseSecretKey, getSupabaseUrl } from './supabase-env.ts';

function environment(values: Record<string, string>) {
  return (name: string) => values[name];
}

Deno.test('uses hosted publishable and secret key dictionaries', () => {
  const read = environment({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_current' }),
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_current' }),
    SUPABASE_PUBLISHABLE_KEY: 'legacy-publishable',
    SUPABASE_SECRET_KEY: 'legacy-secret'
  });
  if (getSupabaseUrl(read) !== 'https://project.supabase.co') throw new Error('URL was not resolved.');
  if (getSupabasePublishableKey(read) !== 'sb_publishable_current') throw new Error('Publishable key dictionary was not preferred.');
  if (getSupabaseSecretKey(read) !== 'sb_secret_current') throw new Error('Secret key dictionary was not preferred.');
});

Deno.test('retains local and legacy key fallbacks', () => {
  const read = environment({ SUPABASE_ANON_KEY: 'local-anon', SUPABASE_SERVICE_ROLE_KEY: 'local-service-role' });
  if (getSupabasePublishableKey(read) !== 'local-anon') throw new Error('Local publishable fallback failed.');
  if (getSupabaseSecretKey(read) !== 'local-service-role') throw new Error('Local secret fallback failed.');
});

Deno.test('fails closed for malformed hosted key dictionaries', () => {
  const read = environment({
    SUPABASE_PUBLISHABLE_KEYS: '{not-json',
    SUPABASE_SECRET_KEYS: JSON.stringify({ staging: 'not-default' })
  });
  if (getSupabasePublishableKey(read) !== '') throw new Error('Malformed publishable dictionary was accepted.');
  if (getSupabaseSecretKey(read) !== '') throw new Error('Unnamed secret dictionary was accepted.');
});
