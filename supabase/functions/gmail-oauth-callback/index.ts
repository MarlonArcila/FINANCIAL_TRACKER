import { configureGmailWatch, exchangeGoogleCode, googleProfile } from "../_shared/gmail.ts";
import { errorResponse, HttpError } from "../_shared/http.ts";
import { consumeOAuthState, requireOAuthCallbackState } from "../_shared/oauth-state.ts";
import { enqueueMailSync } from "../_shared/mail-jobs.ts";
import { assertEntitled, createServiceClient } from "../_shared/supabase.ts";
import { saveTokens } from "../_shared/tokens.ts";

Deno.serve(async (request) => {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("error")) throw new HttpError(400, `google_oauth_${url.searchParams.get("error")}`);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code) throw new HttpError(400, "missing_oauth_code_or_state");
    requireOAuthCallbackState(state);
    const service = createServiceClient();
    const oauth = await consumeOAuthState(service, state, "gmail");
    await assertEntitled(service, oauth.userId);
    const tokens = await exchangeGoogleCode(code, oauth.codeVerifier);
    const profile = await googleProfile(tokens.accessToken);
    const { data: connection, error } = await service.from("source_connections").upsert({
      user_id: oauth.userId,
      provider: "gmail",
      provider_subject: profile.emailAddress,
      email_address: profile.emailAddress,
      status: "active",
      granted_scopes: ["openid", "email", "gmail.readonly"],
      cursor: profile.historyId,
      last_error: null,
    }, { onConflict: "user_id,provider" }).select("*").single();
    if (error) throw error;
    await saveTokens(service, connection.id, tokens);
    await configureGmailWatch(service, connection, tokens.accessToken);
    await enqueueMailSync(service, connection.id, "gmail", null);
    const { error: auditError } = await service.rpc(
      "service_record_audit_event",
      {
        p_user_id: oauth.userId,
        p_actor: "google",
        p_action: "gmail.connected",
        p_entity_type: "source_connection",
        p_entity_id: connection.id,
      },
    );

    if (auditError) throw auditError;
    return Response.redirect(withResult(oauth.returnUrl, "gmail", "connected"), 302);
  } catch (error) {
    return errorResponse(error);
  }
});

function withResult(returnUrl: string, provider: string, status: string): string {
  const url = new URL(returnUrl);
  url.searchParams.set("provider", provider);
  url.searchParams.set("status", status);
  return url.toString();
}
