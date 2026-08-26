import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { verifyWhopStandardWebhookJson } from "./standard-webhook.ts";

const secret = "ws_pilot_test_secret_123456789";
const payload = JSON.stringify({ type: "membership.activated", data: { id: "mem_test" } });
const messageId = "msg_capitalflow_test";
const nowMs = 1_787_783_600_000;
const timestamp = String(Math.floor(nowMs / 1000));

function signature(body: string, ts = timestamp): string {
  return createHmac("sha256", secret).update(`${messageId}.${ts}.${body}`).digest("base64");
}

function headers(body = payload, ts = timestamp): Headers {
  return new Headers({
    "webhook-id": messageId,
    "webhook-timestamp": ts,
    "webhook-signature": `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= v1,${signature(body, ts)}`,
  });
}

test("verifies a valid Whop Standard Webhook with raw dashboard secret semantics", async () => {
  const event = await verifyWhopStandardWebhookJson<{ type: string }>(payload, headers(), secret, { nowMs });
  assert.equal(event.type, "membership.activated");
});

test("rejects a payload changed after signing", async () => {
  const tampered = JSON.stringify({ type: "membership.deactivated", data: { id: "mem_test" } });
  await assert.rejects(
    () => verifyWhopStandardWebhookJson(tampered, headers(payload), secret, { nowMs }),
    /signature/iu,
  );
});

test("rejects webhook timestamps outside the five-minute replay window", async () => {
  const staleTimestamp = String(Math.floor(nowMs / 1000) - 301);
  await assert.rejects(
    () => verifyWhopStandardWebhookJson(payload, headers(payload, staleTimestamp), secret, { nowMs }),
    /timestamp/iu,
  );
});

test("rejects missing Standard Webhook headers", async () => {
  await assert.rejects(
    () => verifyWhopStandardWebhookJson(payload, new Headers(), secret, { nowMs }),
    /headers/iu,
  );
});
