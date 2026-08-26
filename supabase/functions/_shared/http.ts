import { optionalEnv, type EnvReader } from "./env.ts";

const corsBaseHeaders = {
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-retry-count, traceparent, tracestate, baggage",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "vary": "Origin",
} as const;

export function allowedCorsOrigin(read?: EnvReader): string | null {
  let appUrl: string | null;
  try {
    appUrl = optionalEnv("APP_URL", read);
  } catch {
    return null;
  }
  if (!appUrl) return null;

  try {
    const parsed = new URL(appUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function corsHeaders(read?: EnvReader): Record<string, string> {
  const allowedOrigin = allowedCorsOrigin(read);
  return {
    ...corsBaseHeaders,
    ...(allowedOrigin ? { "access-control-allow-origin": allowedOrigin } : {}),
  };
}

export function handleOptions(request: Request, read?: EnvReader): Response | null {
  if (request.method !== "OPTIONS") return null;

  const allowedOrigin = allowedCorsOrigin(read);
  const requestOrigin = request.headers.get("origin");
  if (!allowedOrigin || !requestOrigin || requestOrigin !== allowedOrigin) {
    return new Response(null, { status: 403, headers: { "vary": "Origin" } });
  }

  return new Response(null, { status: 204, headers: corsHeaders(read) });
}

export function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

export function text(data: string, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(data, {
    status,
    headers: { ...corsHeaders(), "content-type": "text/plain; charset=utf-8", ...extraHeaders },
  });
}

export async function readJson<T>(request: Request, maxBytes = 200_000): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > maxBytes) throw new HttpError(413, "request_too_large");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > maxBytes) throw new HttpError(413, "request_too_large");
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

export class HttpError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message, details: error.details ?? null }, error.status);
  console.error(JSON.stringify(safeErrorLogRecord(error)));
  return json({ error: "internal_error" }, 500);
}

export function safeErrorLogRecord(error: unknown): { event: "edge_function_failure"; error_type: "postgrest" | "http" | "error" | "unknown"; error_code: string | null; status: number | null } {
  const value = isRecord(error) ? error : {};
  const code = safeCode(value.code);
  const status = safeStatus(value.status);
  return {
    event: "edge_function_failure",
    error_type: error instanceof HttpError ? "http" : code?.startsWith("PGRST") || /^[0-9A-Z]{5}$/u.test(code ?? "") ? "postgrest" : error instanceof Error ? "error" : "unknown",
    error_code: code,
    status,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function safeCode(value: unknown): string | null { return typeof value === "string" && /^[A-Za-z0-9_]{1,32}$/u.test(value) ? value : null; }
function safeStatus(value: unknown): number | null { return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null; }
