export function vercelProtectionHeaders(secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
  const value = secret?.trim();
  return value ? { 'x-vercel-protection-bypass': value } : {};
}
