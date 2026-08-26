import { recordAuditEvent } from "../_shared/audit.ts";
import { errorResponse, HttpError } from "../_shared/http.ts";
import { assertAnnualEntitled, createServiceClient } from "../_shared/supabase.ts";
import { consumeStorageOAuthState, exchangeStorageCode, saveStorageTokens, storageProfile, storageScopes } from "../_shared/storage-oauth.ts";
import { requireOAuthCallbackState } from "../_shared/oauth-state.ts";

Deno.serve(async (request) => {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("error")) throw new HttpError(400, `storage_oauth_${url.searchParams.get("error")}`);
    const code = url.searchParams.get("code"); const state = url.searchParams.get("state");
    if (!code) throw new HttpError(400, "missing_oauth_code_or_state");
    requireOAuthCallbackState(state);
    const service = createServiceClient();
    const oauth = await consumeStorageOAuthState(service, state);
    await assertAnnualEntitled(service, oauth.userId);
    const tokens = await exchangeStorageCode(oauth.provider, code, oauth.codeVerifier);
    const profile = await storageProfile(oauth.provider, tokens.accessToken);
    const { data: connection, error } = await service.from("storage_connections").upsert({
      user_id: oauth.userId, provider: oauth.provider, provider_subject: profile.subject, account_label: profile.label,
      status: "active", granted_scopes: storageScopes(oauth.provider), last_error: null, backup_frequency: "weekly", next_backup_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    }, { onConflict: "user_id,provider" }).select("*").single();
    if (error) throw error;
    await saveStorageTokens(service, connection.id, tokens);
    await recordAuditEvent(service, {
      userId: oauth.userId,
      actor: oauth.provider,
      action: "storage.connected",
      entityType: "storage_connection",
      entityId: connection.id,
    });
    const redirect = new URL(oauth.returnUrl); redirect.searchParams.set("storage", oauth.provider); redirect.searchParams.set("status", "connected");
    return Response.redirect(redirect.toString(), 302);
  } catch (error) { return errorResponse(error); }
});
