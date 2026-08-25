import assert from "node:assert/strict";
import test from "node:test";

import { uploadBackupFile } from "./cloud-storage.ts";

test("Google Drive reconciles by backup run id and appProperties", async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  let lookupCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
    if (method === "GET" && url.includes("/files?")) {
      lookupCount += 1;
      return { ok: true, json: async () => lookupCount === 1 ? { files: [] } : { files: [{ id: "drive-file-1", name: "existing.json" }] } } as Response;
    }
    if (method === "POST") return { ok: true, json: async () => ({ id: "drive-file-1", name: "created.json", size: "10", createdTime: "2026-08-18T00:00:00Z" }) } as Response;
    if (method === "PATCH") return { ok: true, json: async () => ({ id: "drive-file-1", name: "existing.json", size: "10", createdTime: "2026-08-18T00:00:00Z" }) } as Response;
    throw new Error("unexpected_google_request");
  }) as typeof fetch;
  try {
    const first = await uploadBackupFile("google_drive", "local-token", "capitalflow-backup-run-run-1.json", "{}", "run-1");
    const second = await uploadBackupFile("google_drive", "local-token", "capitalflow-backup-run-run-1.json", "{}", "run-1");
    assert.equal(first.id, "drive-file-1");
    assert.equal(second.id, "drive-file-1");
    assert.equal(calls.filter((call) => call.method === "POST").length, 1);
    assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
    assert.ok(calls.some((call) => call.url.includes("appProperties")));
    assert.ok(calls.some((call) => call.body?.includes("capitalflow_backup_run_id")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OneDrive uses a deterministic app-folder destination on retry", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/special/approot")) return { ok: true, json: async () => ({ id: "approot-1" }) } as Response;
    if (method === "PUT") return { ok: true, json: async () => ({ id: "one-file-1", name: "capitalflow-backup-run-run-1.json", size: 2 }) } as Response;
    throw new Error("unexpected_onedrive_request");
  }) as typeof fetch;
  try {
    await uploadBackupFile("onedrive", "local-token", "capitalflow-backup-run-run-1.json", "{}", "run-1");
    await uploadBackupFile("onedrive", "local-token", "capitalflow-backup-run-run-1.json", "{}", "run-1");
    const puts = calls.filter((call) => call.method === "PUT");
    assert.equal(puts.length, 2);
    assert.equal(puts[0].url, puts[1].url);
    assert.ok(puts[0].url.includes("capitalflow-backup-run-run-1.json"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
