type EnvironmentReader = (name: string) => string | undefined;

const readEnvironment: EnvironmentReader = (name) => Deno.env.get(name);

function namedKey(variableName: string, read: EnvironmentReader) {
  const raw = read(variableName);
  if (!raw) return '';
  try {
    const keys = JSON.parse(raw) as Record<string, unknown>;
    return typeof keys.default === 'string' ? keys.default : '';
  } catch {
    return '';
  }
}

export function getSupabaseUrl(read: EnvironmentReader = readEnvironment) {
  return read('SUPABASE_URL') ?? '';
}

export function getSupabasePublishableKey(read: EnvironmentReader = readEnvironment) {
  return namedKey('SUPABASE_PUBLISHABLE_KEYS', read)
    || read('SUPABASE_PUBLISHABLE_KEY')
    || read('SUPABASE_ANON_KEY')
    || '';
}

export function getSupabaseSecretKey(read: EnvironmentReader = readEnvironment) {
  return namedKey('SUPABASE_SECRET_KEYS', read)
    || read('SUPABASE_SECRET_KEY')
    || read('SUPABASE_SERVICE_ROLE_KEY')
    || '';
}
