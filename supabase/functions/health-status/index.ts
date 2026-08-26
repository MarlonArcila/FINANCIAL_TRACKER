import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { requireCronSecret } from "../_shared/cron.ts";
import { errorResponse, handleOptions, HttpError, json } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";

Deno.serve(async (request: Request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;

  try {
    if (request.method !== "GET") throw new HttpError(405, "method_not_allowed");
    requireCronSecret(request);

    const service = createServiceClient();
    const { data, error } = await service.rpc("service_operational_health");
    if (error) throw error;

    const status = data && typeof data === "object" && !Array.isArray(data)
      ? String((data as Record<string, unknown>).status ?? "unknown")
      : "unknown";

    return json(data, status === "degraded" ? 503 : 200, {
      "cache-control": "no-store, max-age=0",
    });
  } catch (error) {
    return errorResponse(error);
  }
});
