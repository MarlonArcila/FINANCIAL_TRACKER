export const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

export function handleOptions(request: Request): Response | null {
  return request.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders }) : null;
}

export function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

export function text(data: string, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(data, {
    status,
    headers: { ...corsHeaders, "content-type": "text/plain; charset=utf-8", ...extraHeaders },
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
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message, details: error.details ?? null }, error.status);
  console.error(error);
  return json({ error: "internal_error" }, 500);
}
