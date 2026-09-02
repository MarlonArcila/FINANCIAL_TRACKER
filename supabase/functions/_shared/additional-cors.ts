import { corsHeaders } from "./http.ts";

export type EnvReader = (name: string) => string | undefined;
export const APP_ADDITIONAL_ORIGINS_ENV = "APP_ADDITIONAL_ORIGINS";

function runtimeEnv(name: string): string | undefined {
  const runtime = globalThis as typeof globalThis & {
    Deno?: { env?: { get?: (key: string) => string | undefined } };
  };
  return runtime.Deno?.env?.get?.(name);
}

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
  read: EnvReader = runtimeEnv,
): string | null {
  const normalizedRequestOrigin = normalizeHttpOrigin(requestOrigin);
  if (!normalizedRequestOrigin) return null;

  const configured = read(APP_ADDITIONAL_ORIGINS_ENV) ?? "";
  const allowedOrigins = configured
    .split(",")
    .map((value) => normalizeHttpOrigin(value))
    .filter((value): value is string => Boolean(value));

  return allowedOrigins.includes(normalizedRequestOrigin)
    ? normalizedRequestOrigin
    : null;
}

export function additionalCorsHeadersForRequest(
  request: Request,
  read: EnvReader = runtimeEnv,
): Record<string, string> | null {
  const allowedOrigin = additionalAllowedCorsOrigin(request.headers.get("origin"), read);
  if (!allowedOrigin) return null;
  return {
    ...corsHeaders(),
    "access-control-allow-origin": allowedOrigin,
    "vary": "Origin",
  };
}

export async function withAdditionalCors(
  request: Request,
  handler: () => Response | Promise<Response>,
  read: EnvReader = runtimeEnv,
): Promise<Response> {
  const additionalHeaders = additionalCorsHeadersForRequest(request, read);
  if (request.method === "OPTIONS" && additionalHeaders) {
    return new Response(null, { status: 204, headers: additionalHeaders });
  }

  const response = await handler();
  if (!additionalHeaders) return response;

  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(additionalHeaders)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
