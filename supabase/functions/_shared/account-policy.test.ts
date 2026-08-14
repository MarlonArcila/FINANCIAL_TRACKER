import assert from "node:assert/strict";
import test from "node:test";
import { decideAccountCreatePolicy } from "./account-policy.ts";

test("first account is always the principal account", () => {
  assert.deepEqual(decideAccountCreatePolicy({ interval: "weekly", activeAccountCount: 0, requestedPurpose: "trip" }), {
    allowed: true, isPrimary: true, purpose: "general", reason: "first_account",
  });
});

test("weekly membership cannot create a second account", () => {
  assert.equal(decideAccountCreatePolicy({ interval: "weekly", activeAccountCount: 1, requestedPurpose: "trip" }).allowed, false);
});

test("annual membership can create purpose-scoped accounts", () => {
  const result = decideAccountCreatePolicy({ interval: "annual", activeAccountCount: 1, requestedPurpose: "trip" });
  assert.equal(result.allowed, true);
  assert.equal(result.isPrimary, false);
  assert.equal(result.purpose, "trip");
});
