import { optionalEnv, requiredEnv } from "../_shared/env.ts";
import { errorResponse, handleOptions, HttpError, json, readJson } from "../_shared/http.ts";
import { createOAuthState } from "../_shared/oauth-state.ts";
import { assertEntitled, createServiceClient, requireUser } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const preflight = handleOptions(request); if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const { user } = await requireUser(request);
    const service = createServiceClient();
    await assertEntitled(service, user.id);
    const body = await readJson<{ returnUrl?: string }>(request, 10_000);
    const returnUrl = validateReturnUrl(body.returnUrl);
    const oauth = await createOAuthState(service, { userId: user.id, provider: "outlook", returnUrl });
    const tenant = optionalEnv("MICROSOFT_TENANT") ?? "common";
    const url = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
    url.searchParams.set("client_id", requiredEnv("MICROSOFT_CLIENT_ID"));
    url.searchParams.set("redirect_uri", requiredEnv("MICROSOFT_REDIRECT_URI"));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", "openid offline_access User.Read Mail.Read");
    url.searchParams.set("state", oauth.state);
    url.searchParams.set("code_challenge", oauth.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return json({ authorizationUrl: url.toString() });
  } catch (error) { return errorResponse(error); }
});

function validateReturnUrl(value: string | undefined): string {
  const appUrl = new URL(requiredEnv("APP_URL"));
  const candidate = new URL(value || `${appUrl.origin}/#/integrations`);
  if (candidate.origin !== appUrl.origin) throw new HttpError(422, "invalid_return_url");
  return candidate.toString();
}
