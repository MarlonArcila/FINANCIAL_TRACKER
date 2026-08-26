import { createPilotUser, deletePilotUser, supabaseContext } from "./pilot-lib.mjs";

const ctx = supabaseContext();
let a = null;
let b = null;
try {
  a = await createPilotUser(ctx, "rls-a", { interval: "weekly" });
  b = await createPilotUser(ctx, "rls-b", { interval: "weekly" });

  const { data: aAccount, error: aInsertError } = await a.client.from("accounts").insert({
    user_id: a.user.id, name: "RLS tenant A", type: "checking", currency: "COP",
  }).select("id,user_id,name").single();
  if (aInsertError || !aAccount) throw aInsertError ?? new Error("RLS_A_INSERT_FAILED");

  const { data: bAccount, error: bInsertError } = await b.client.from("accounts").insert({
    user_id: b.user.id, name: "RLS tenant B", type: "checking", currency: "COP",
  }).select("id,user_id,name").single();
  if (bInsertError || !bAccount) throw bInsertError ?? new Error("RLS_B_INSERT_FAILED");

  const { data: crossRead, error: crossReadError } = await a.client.from("accounts").select("id").eq("id", bAccount.id);
  if (crossReadError) throw crossReadError;
  if ((crossRead ?? []).length !== 0) throw new Error("RLS_CROSS_TENANT_READ_LEAK");

  const { data: crossUpdate, error: crossUpdateError } = await a.client.from("accounts")
    .update({ name: "forbidden update" }).eq("id", bAccount.id).select("id");
  if (crossUpdateError) throw crossUpdateError;
  if ((crossUpdate ?? []).length !== 0) throw new Error("RLS_CROSS_TENANT_UPDATE_LEAK");

  const { data: crossDelete, error: crossDeleteError } = await a.client.from("accounts")
    .delete().eq("id", bAccount.id).select("id");
  if (crossDeleteError) throw crossDeleteError;
  if ((crossDelete ?? []).length !== 0) throw new Error("RLS_CROSS_TENANT_DELETE_LEAK");

  const { error: crossInsertError } = await a.client.from("accounts").insert({
    user_id: b.user.id, name: "forbidden insert", type: "checking", currency: "COP",
  });
  if (!crossInsertError) throw new Error("RLS_CROSS_TENANT_INSERT_ALLOWED");

  const { data: crossProfile, error: crossProfileError } = await a.client.from("profiles").select("id").eq("id", b.user.id);
  if (crossProfileError) throw crossProfileError;
  if ((crossProfile ?? []).length !== 0) throw new Error("RLS_CROSS_TENANT_PROFILE_LEAK");

  const { error: privateSchemaError } = await a.client.schema("private").from("audit_events").select("id").limit(1);
  if (!privateSchemaError) throw new Error("PRIVATE_SCHEMA_EXPOSED_TO_AUTHENTICATED");

  console.log(`RLS_REAL_USER_A=${a.user.id}`);
  console.log(`RLS_REAL_USER_B=${b.user.id}`);
  console.log("RLS_TWO_REAL_USERS=GREEN");
} finally {
  if (a?.user?.id) await deletePilotUser(ctx, a.user.id).catch((error) => console.error(`cleanup_a:${error.message}`));
  if (b?.user?.id) await deletePilotUser(ctx, b.user.id).catch((error) => console.error(`cleanup_b:${error.message}`));
}
