import { createPilotUser, deletePilotUser, firstEnv, invokeEdge, openBrowser, supabaseContext, waitFor } from "./pilot-lib.mjs";

const ctx = supabaseContext();
const pilotAppUrl = firstEnv("CF_PILOT_APP_URL", "PILOT_APP_URL");
if (!pilotAppUrl) throw new Error("PILOT_APP_URL_REQUIRED");
const app = new URL(pilotAppUrl);
if (app.protocol !== "https:") throw new Error("PILOT_APP_URL_MUST_USE_HTTPS");
const timeoutMs = Number(firstEnv("CF_OAUTH_TIMEOUT_MS") ?? "600000");
let pilot = null;
let connectionId = null;
try {
  pilot = await createPilotUser(ctx, "drive", { interval: "annual" });
  const started = await invokeEdge(ctx, "storage-oauth-start", pilot.accessToken, {
    body: { provider: "google_drive", returnUrl: `${app.origin}/#/data?pilot_drive_e2e=1` },
  });
  const authorizationUrl = started.payload?.authorizationUrl;
  if (typeof authorizationUrl !== "string") throw new Error("DRIVE_AUTHORIZATION_URL_MISSING");
  const requestedScopes = new Set((new URL(authorizationUrl).searchParams.get("scope") ?? "").split(/\s+/u).filter(Boolean));
  if (!requestedScopes.has("https://www.googleapis.com/auth/drive.appdata")) throw new Error("DRIVE_AUTHORIZATION_URL_MISSING_APPDATA_SCOPE");
  console.log("GOOGLE_DRIVE_ACTION=AUTHORIZE_APPDATAFOLDER_IN_BROWSER");
  openBrowser(authorizationUrl);

  const connection = await waitFor("GOOGLE_DRIVE_OAUTH", async () => {
    const { data, error } = await ctx.service.from("storage_connections")
      .select("id,provider,status,granted_scopes")
      .eq("user_id", pilot.user.id).eq("provider", "google_drive").eq("status", "active").maybeSingle();
    if (error) throw error;
    return data ?? null;
  }, { timeoutMs });
  connectionId = connection.id;
  const scopes = Array.isArray(connection.granted_scopes) ? connection.granted_scopes : [];
  if (!scopes.some((scope) => scope === "drive.appdata" || scope === "https://www.googleapis.com/auth/drive.appdata")) throw new Error("DRIVE_APPDATA_SCOPE_NOT_GRANTED");

  const marker = `Drive E2E ${Date.now()}`;
  const { data: account, error: accountError } = await pilot.client.from("accounts").insert({
    user_id: pilot.user.id, name: marker, type: "checking", currency: "COP", opening_balance_minor: 1234500,
  }).select("id,name,opening_balance_minor").single();
  if (accountError || !account) throw accountError ?? new Error("DRIVE_E2E_ACCOUNT_CREATE_FAILED");

  const backup = await invokeEdge(ctx, "cloud-backup-create", pilot.accessToken, {
    body: { connectionId, kind: "manual" },
  });
  const backupId = backup.payload?.backupId;
  if (typeof backupId !== "string" || typeof backup.payload?.checksum !== "string" || !/^[0-9a-f]{64}$/u.test(backup.payload.checksum)) {
    throw new Error("DRIVE_BACKUP_RESULT_INVALID");
  }

  const mutatedName = `${marker} MUTATED`;
  const { error: mutateError } = await pilot.client.from("accounts").update({ name: mutatedName }).eq("id", account.id);
  if (mutateError) throw mutateError;
  const restored = await invokeEdge(ctx, "cloud-backup-restore", pilot.accessToken, {
    body: { connectionId, backupId, confirmation: "RESTAURAR" },
  });
  if (restored.payload?.restored !== true || typeof restored.payload?.safetyBackupName !== "string") throw new Error("DRIVE_RESTORE_RESULT_INVALID");

  const { data: restoredAccount, error: restoredAccountError } = await pilot.client.from("accounts")
    .select("id,name,opening_balance_minor").eq("id", account.id).single();
  if (restoredAccountError || !restoredAccount) throw restoredAccountError ?? new Error("DRIVE_RESTORED_ACCOUNT_MISSING");
  if (restoredAccount.name !== marker || Number(restoredAccount.opening_balance_minor) !== 1234500) throw new Error("DRIVE_RESTORE_CONTENT_MISMATCH");

  const { data: backups, error: backupsError } = await ctx.service.from("cloud_backups")
    .select("id,kind,status,checksum_sha256,remote_file_id")
    .eq("user_id", pilot.user.id).order("created_at", { ascending: true });
  if (backupsError) throw backupsError;
  if (!(backups ?? []).some((row) => row.id === backupId && row.status === "restored")) throw new Error("DRIVE_BACKUP_NOT_MARKED_RESTORED");
  if (!(backups ?? []).some((row) => row.kind === "pre_restore")) throw new Error("DRIVE_PRE_RESTORE_SAFETY_COPY_MISSING");

  await invokeEdge(ctx, "storage-disconnect", pilot.accessToken, { body: { connectionId } });
  console.log(`GOOGLE_DRIVE_BACKUP_ID=${backupId}`);
  console.log("GOOGLE_DRIVE_UPLOAD_DOWNLOAD_CHECKSUM_RESTORE=GREEN");
  console.log("GOOGLE_DRIVE_PRE_RESTORE_COPY=GREEN");
  console.log("GOOGLE_DRIVE_REAL_OAUTH_E2E=GREEN");
  console.log("GOOGLE_DRIVE_REMOTE_TEST_FILES=LEFT_IN_APPDATAFOLDER_FOR_AUDIT");
} finally {
  if (pilot?.user?.id) await deletePilotUser(ctx, pilot.user.id).catch((error) => console.error(`cleanup_drive_user:${error.message}`));
}
