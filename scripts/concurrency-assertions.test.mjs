import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

import { ConcurrencyFailure, assertBackupLogicalRun, assertBackupRace, assertWatchRace, assertWatchPrecondition, assertBackupPrecondition, classifyPsqlFailure, makeFixtureIds } from "./concurrency-assertions.mjs";

test("watch race accepts one winner from either client", () => {
  assert.equal(assertWatchRace([["watch-id", "gmail", "token"]], [], "watch-id")[0], "watch-id");
  assert.equal(assertWatchRace([], [["watch-id", "gmail", "token"]], "watch-id")[0], "watch-id");
});

test("watch race rejects zero, duplicate, and wrong identities", () => {
  assert.throws(() => assertWatchRace([], [], "watch-id"), new ConcurrencyFailure("race_start", "unexpected_claim_count"));
  assert.throws(() => assertWatchRace([["watch-id", "gmail", "token"]], [["watch-id", "gmail", "token"]], "watch-id"), new ConcurrencyFailure("identity_assertion", "duplicate_claim"));
  assert.throws(() => assertWatchRace([["watch-id", "gmail", "token"]], [["other-id", "gmail", "token"]], "watch-id"), new ConcurrencyFailure("identity_assertion", "unexpected_claim_identity"));
  assert.throws(() => assertWatchRace([["other-id", "gmail", "token"]], [], "watch-id"), new ConcurrencyFailure("identity_assertion", "unexpected_claim_identity"));
});

test("backup race requires one winner for the target connection", () => {
  const row = ["run-id", "backup-id", "user-id", "google_drive", "weekly", "2026-08-18T00:00:00Z", "token"];
  assert.equal(assertBackupRace([row], [], "backup-id")[0], "run-id");
  assert.throws(() => assertBackupRace([], [], "backup-id"), new ConcurrencyFailure("race_start", "unexpected_claim_count"));
  assert.throws(() => assertBackupRace([row], [row], "backup-id"), new ConcurrencyFailure("identity_assertion", "duplicate_claim"));
  assert.throws(() => assertBackupRace([row], [["other-run", "other-id", "user-id", "google_drive", "weekly", "2026-08-18T00:00:00Z", "token"]], "backup-id"), new ConcurrencyFailure("identity_assertion", "unexpected_claim_identity"));
});
test("backup logical run requires exactly one row", () => {
  assert.doesNotThrow(() => assertBackupLogicalRun(1));
  assert.throws(() => assertBackupLogicalRun(0), new ConcurrencyFailure("logical_row_assertion", "expected_logical_run_missing"));
  assert.throws(() => assertBackupLogicalRun(2), new ConcurrencyFailure("logical_row_assertion", "duplicate_logical_run"));
});

test("classifies sanitized psql failures without exposing stderr", () => {
  assert.deepEqual(classifyPsqlFailure("ERROR: 23514: new row violates check constraint \"example_check\""), { code: "check_violation", sqlstate: "23514", constraint: "example_check" });
  assert.deepEqual(classifyPsqlFailure("ERROR: 23505: duplicate key value violates unique constraint \"example_unique\""), { code: "unique_violation", sqlstate: "23505", constraint: "example_unique" });
  assert.deepEqual(classifyPsqlFailure("ERROR: 23503: violates foreign key constraint \"example_fk\""), { code: "foreign_key_violation", sqlstate: "23503", constraint: "example_fk" });
  assert.equal(classifyPsqlFailure("ERROR: 23502: null value violates not-null constraint \"example_not_null\"").code, "not_null_violation");
  assert.equal(classifyPsqlFailure("column does not exist").code, "undefined_column");
  assert.deepEqual(classifyPsqlFailure("ERROR: 42501: permission denied for table private.x"), { code: "permission_denied", sqlstate: "42501", relation: "private.x" });
  assert.equal(classifyPsqlFailure("", "ENOENT").code, "psql_not_found");
  assert.equal(classifyPsqlFailure("violates constraint \"bad name; DROP TABLE\"").constraint, undefined);
  assert.equal(classifyPsqlFailure("unclassified database failure").code, "unknown_psql_error");
});

test("global preconditions reject contaminated watch and backup scopes", () => {
  assert.doesNotThrow(() => assertWatchPrecondition(1, 1, 1, 0));
  assert.throws(() => assertWatchPrecondition(0, 1, 1, 0), new ConcurrencyFailure("precondition", "local_db_contaminated"));
  assert.throws(() => assertWatchPrecondition(2, 1, 1, 0), new ConcurrencyFailure("precondition", "local_db_contaminated"));
  assert.doesNotThrow(() => assertBackupPrecondition(1, 1, 1, 0));
  assert.throws(() => assertBackupPrecondition(1, 0, 1, 0), new ConcurrencyFailure("precondition", "local_db_contaminated"));
  assert.throws(() => assertBackupPrecondition(1, 1, 1, 1), new ConcurrencyFailure("precondition", "local_db_contaminated"));
});

test("fixture factories produce isolated valid IDs and emails", () => {
  const scenarios = ["mail", "watch", "backup", "manual"].map(makeFixtureIds);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  const fields = ["userId", "connectionId", "jobId", "subscriptionId", "storageConnectionId"];
  const ids = scenarios.flatMap((fixture) => fields.map((field) => fixture[field]));
  assert.equal(new Set(ids).size, ids.length);
  for (const fixture of scenarios) {
    for (const field of fields) assert.match(fixture[field], uuidPattern);
    assert.match(fixture.email, /^[a-z]+-[0-9a-f-]+@example\.invalid$/iu);
  }
  assert.notEqual(scenarios[0].userId, scenarios[1].userId);
  assert.notEqual(scenarios[1].userId, scenarios[2].userId);
  assert.notEqual(scenarios[2].userId, scenarios[3].userId);
  const next = makeFixtureIds("mail");
  assert.notEqual(scenarios[0].userId, next.userId);
});

test("fixture cleanup is exact and does not mask users_pkey", async () => {
  const source = await readFile(new URL("./test-local-worker-concurrency.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /on conflict\s+do nothing/iu);
  assert.doesNotMatch(source, /delete from [^;]+like/iu);
  assert.match(source, /delete from auth\.users where id='\$\{userId\}'/u);
});
