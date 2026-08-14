export function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function optionalEnv(name: string): string | null {
  return Deno.env.get(name)?.trim() || null;
}

export function serviceKey(): string {
  return optionalEnv("SUPABASE_SECRET_KEY") ?? requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
}
