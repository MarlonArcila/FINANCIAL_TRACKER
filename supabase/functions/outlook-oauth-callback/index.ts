import { errorResponse, HttpError } from "../_shared/http.ts";
import { consumeOAuthState } from "../_shared/oauth-state.ts";
import { enqueueMailSync } from "../_shared/mail-jobs.ts";
import { configureOutlookSubscription, exchangeMicrosoftCode, microsoftProfile } from "../_shared/outlook.ts";
import { assertEntitled, createServiceClient } from "../_shared/supabase.ts";
import { saveTokens } from "../_shared/tokens.ts";

Deno.serve(async (request) => {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("error")) throw new HttpError(400, `microsoft_oauth_${url.searchParams.get("error")}`);
    const code = url.searchParams.get("code"); const state = url.searchParams.get("state");
    if (!code || !state) throw new HttpError(400, "missing_oauth_code_or_state");
    const service = createServiceClient();
    const oauth = await consumeOAuthState(service, state, "outlook");
    await assertEntitled(service, oauth.userId);
    const tokens = await exchangeMicrosoftCode(code, oauth.codeVerifier);
    const profile = await microsoftProfile(tokens.accessToken);
    const email = profile.mail ?? profile.userPrincipalName ?? null;
    const { data: connection, error } = await service.from("source_connections").upsert({
      user_id: oauth.userId, provider: "outlook", provider_subject: profile.id, email_address: email,
      status: "active", granted_scopes: ["openid", "offline_access", "User.Read", "Mail.Read"], last_error: null,
    }, { onConflict: "user_id,provider" }).select("*").single();
    if (error) throw error;
    await saveTokens(service, connection.id, tokens);
    await configureOutlookSubscription(service, connection, tokens.accessToken);
    await enqueueMailSync(service, connection.id, "outlook", null);
    await service.schema("private").from("audit_events").insert({ user_id: oauth.userId, actor: "microsoft", action: "outlook.connected", entity_type: "source_connection", entity_id: connection.id });
    const redirect = new URL(oauth.returnUrl); redirect.searchParams.set("provider", "outlook"); redirect.searchParams.set("status", "connected");
    return Response.redirect(redirect.toString(), 302);
  } catch (error) { console.error(error); return errorResponse(error); }
});
