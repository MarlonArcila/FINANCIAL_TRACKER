import { requiredEnv } from "../_shared/env.ts";
import { errorResponse, handleOptions, HttpError, json, readJson } from "../_shared/http.ts";
import { withAdditionalCors } from "../_shared/additional-cors.ts";
import { enforceUserRateLimit, RATE_LIMIT_POLICIES } from "../_shared/rate-limit.ts";
import { assertAnnualEntitled, createServiceClient, requireUser } from "../_shared/supabase.ts";
import { createStorageOAuthState, storageAuthorizationUrl, type StorageProvider } from "../_shared/storage-oauth.ts";

Deno.serve((request) => withAdditionalCors(request, async () => {
  const preflight = handleOptions(request); if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const { user } = await requireUser(request);
    const service = createServiceClient();
    await assertAnnualEntitled(service, user.id);
    await enforceUserRateLimit(service, user.id, RATE_LIMIT_POLICIES.STORAGE_OAUTH_START);
    const body = await readJson<{ provider?: StorageProvider; returnUrl?: string }>(request, 20_000);
    if (body.provider !== "google_drive") throw new HttpError(422, "invalid_storage_provider");
    const app = new URL(requiredEnv("APP_URL"));
    const returnUrl = new URL(body.returnUrl || `${app.origin}/#/data`);
    if (returnUrl.origin !== app.origin) throw new HttpError(422, "invalid_return_url");
    const oauth = await createStorageOAuthState(service, { userId: user.id, provider: body.provider, returnUrl: returnUrl.toString() });
    return json({ authorizationUrl: storageAuthorizationUrl(body.provider, oauth.state, oauth.codeChallenge) });
  } catch (error) { return errorResponse(error); }
}));
