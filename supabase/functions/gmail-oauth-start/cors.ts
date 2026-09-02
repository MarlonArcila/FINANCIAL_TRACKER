export type EnvReader = (name: string) => string | undefined;

export const GMAIL_OAUTH_ADDITIONAL_ORIGINS_ENV = "GMAIL_OAUTH_ADDITIONAL_ORIGINS";

function normalizeHttpOrigin(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate || candidate === "*") return null;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function additionalAllowedCorsOrigin(
  requestOrigin: string | null,
  read: EnvReader,
): string | null {
  const normalizedRequestOrigin = normalizeHttpOrigin(requestOrigin);
  if (!normalizedRequestOrigin) return null;

  const configured = read(GMAIL_OAUTH_ADDITIONAL_ORIGINS_ENV) ?? "";
  const allowedOrigins = configured
    .split(",")
    .map((value) => normalizeHttpOrigin(value))
    .filter((value): value is string => Boolean(value));

  return allowedOrigins.includes(normalizedRequestOrigin)
    ? normalizedRequestOrigin
    : null;
}

export function isAllowedGmailOauthReturnOrigin(
  candidateOrigin: string,
  appOrigin: string,
  read: EnvReader,
): boolean {
  const normalizedCandidate = normalizeHttpOrigin(candidateOrigin);
  const normalizedApp = normalizeHttpOrigin(appOrigin);
  if (!normalizedCandidate || !normalizedApp) return false;
  if (normalizedCandidate === normalizedApp) return true;
  return additionalAllowedCorsOrigin(normalizedCandidate, read) === normalizedCandidate;
}
