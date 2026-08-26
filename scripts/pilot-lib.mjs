import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

export function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

export function requiredEnv(...names) {
  const value = firstEnv(...names);
  if (!value) throw new Error(`MISSING_ENV_${names.join("_OR_")}`);
  return value;
}

export function supabaseContext() {
  const projectRef = firstEnv("CF_SUPABASE_PROJECT_REF") ?? "xxmbqbnryhvybhlwivgq";
  const url = firstEnv("SUPABASE_URL") ?? `https://${projectRef}.supabase.co`;
  const publishableKey = firstEnv("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY");
  const serviceKey = firstEnv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  if (!publishableKey) throw new Error("MISSING_SUPABASE_PUBLISHABLE_KEY");
  if (!serviceKey) throw new Error("MISSING_SUPABASE_SECRET_OR_SERVICE_ROLE_KEY");
  const publicClient = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return { projectRef, url, publishableKey, serviceKey, publicClient, service };
}

export function randomToken(bytes = 8) {
  return crypto.randomBytes(bytes).toString("hex");
}

export async function createPilotUser(ctx, tag, { interval = null } = {}) {
  const token = randomToken(8);
  const email = `cf-${tag}-${Date.now()}-${token}@example.invalid`;
  const password = `Cf!${randomToken(18)}aA1`;
  const { data, error } = await ctx.service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("AUTH_ADMIN_CREATE_USER_FAILED");
  const user = data.user;
  if (interval) {
    if (!new Set(["weekly", "annual"]).has(interval)) {
      await ctx.service.auth.admin.deleteUser(user.id).catch(() => {});
      throw new Error("PILOT_SUBSCRIPTION_INTERVAL_INVALID");
    }
    const { error: subError } = await ctx.service.rpc("service_apply_whop_membership", {
      p_user_id: user.id,
      p_provider_customer_id: null,
      p_provider_membership_id: `pilot-${tag}-${token}`,
      p_provider_plan_id: `pilot-${interval}`,
      p_interval: interval,
      p_status: "active",
      p_current_period_start: new Date().toISOString(),
      p_current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
      p_cancel_at_period_end: false,
      p_raw_status: "pilot_external_gate",
    });
    if (subError) {
      await ctx.service.auth.admin.deleteUser(user.id).catch(() => {});
      throw subError;
    }
  }
  const client = createClient(ctx.url, ctx.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session?.access_token) {
    await ctx.service.auth.admin.deleteUser(user.id).catch(() => {});
    throw signInError ?? new Error("AUTH_SIGNIN_FAILED");
  }
  return { user, email, password, client, accessToken: signIn.session.access_token };
}

export async function deletePilotUser(ctx, userId) {
  const { error } = await ctx.service.auth.admin.deleteUser(userId);
  if (error) throw error;
}

export async function invokeEdge(ctx, slug, accessToken, { method = "POST", body = undefined, headers = {} } = {}) {
  const response = await fetch(`${ctx.url}/functions/v1/${slug}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "cache-control": "no-cache",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let payload = null;
  if (raw) {
    try { payload = JSON.parse(raw); } catch { payload = raw; }
  }
  if (!response.ok) {
    const safe = typeof payload === "object" && payload ? JSON.stringify(payload) : String(payload ?? "");
    throw new Error(`EDGE_${slug}_HTTP_${response.status}:${safe.slice(0, 500)}`);
  }
  return { response, payload };
}

export function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export async function waitFor(label, fn, { timeoutMs = 600_000, intervalMs = 3_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) { lastError = error; }
    await sleep(intervalMs);
  }
  if (lastError) throw new Error(`${label}_TIMEOUT:${lastError instanceof Error ? lastError.message : String(lastError)}`);
  throw new Error(`${label}_TIMEOUT`);
}

export function openBrowser(url) {
  console.log(`ACTION_URL=${url}`);
  if (process.env.CF_NO_BROWSER_OPEN === "1") return;
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.unref();
  } catch {}
}
