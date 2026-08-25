import { randomUUID } from "node:crypto";

export class ConcurrencyFailure extends Error {
  constructor(stage, code) {
    super(code);
    this.stage = stage;
    this.code = code;
  }
}
export function makeFixtureIds(scenario) { const uuid = () => randomUUID(); return { scenario, userId: uuid(), email: scenario + "-" + uuid() + "@example.invalid", connectionId: uuid(), jobId: uuid(), subscriptionId: uuid(), storageConnectionId: uuid() }; }

export function classifyPsqlFailure(stderr = "", spawnCode = "") {
  if (spawnCode === "ENOENT") return { code: "psql_not_found" };
  const sqlstate = stderr.match(/SQLSTATE[^0-9A-Z]*([0-9A-Z]{5})/i)?.[1] ?? stderr.match(/\b(23505|23503|23502|23514|42703|42883|42501|42601)\b/)?.[1];
  const byState = { "23505": "unique_violation", "23503": "foreign_key_violation", "23502": "not_null_violation", "23514": "check_violation", "42703": "undefined_column", "42883": "undefined_function", "42501": "permission_denied", "42601": "syntax_error" };
  const constraintMatch = stderr.match(/(?:violates (?:check|foreign key|unique) constraint|CONSTRAINT NAME:)\s*["']?([A-Za-z0-9_.-]{1,128})["']?/i);
  const constraint = constraintMatch?.[1];
  const relationMatch = stderr.match(/permission denied for (?:table|relation) ([A-Za-z0-9_.-]{1,128})/i);
  const relation = relationMatch?.[1];
  if (sqlstate && byState[sqlstate]) return { code: byState[sqlstate], sqlstate, ...(constraint ? { constraint } : {}), ...(relation ? { relation } : {}) };
  const lower = stderr.toLowerCase();
  if (lower.includes("could not connect") || lower.includes("connection refused") || lower.includes("no route to host")) return { code: "connection_failure" };
  if (lower.includes("foreign key")) return { code: "foreign_key_violation", ...(constraint ? { constraint } : {}) };
  if (lower.includes("constraint") || lower.includes("check violation")) return { code: "constraint_violation", ...(constraint ? { constraint } : {}) };
  if (lower.includes("duplicate key") || lower.includes("already exists")) return { code: "unique_violation" };
  if (lower.includes("not-null") || lower.includes("not null")) return { code: "not_null_violation" };
  if (lower.includes("does not exist") && lower.includes("column")) return { code: "undefined_column" };
  if (lower.includes("does not exist") && lower.includes("function")) return { code: "undefined_function" };
  if (lower.includes("permission denied")) return { code: "permission_denied", ...(relation ? { relation } : {}) };
  if (lower.includes("syntax error")) return { code: "syntax_error" };
  return { code: "unknown_psql_error" };
}

export function assertWatchPrecondition(eligibleCount, targetEligibleCount, targetCount, targetLeaseCount) {
  if (eligibleCount !== 1 || targetEligibleCount !== 1 || targetCount !== 1 || targetLeaseCount !== 0) throw new ConcurrencyFailure("precondition", "local_db_contaminated");
}

export function assertBackupPrecondition(eligibleCount, targetEligibleCount, targetCount, targetRunCount) {
  if (eligibleCount !== 1 || targetEligibleCount !== 1 || targetCount !== 1 || targetRunCount !== 0) throw new ConcurrencyFailure("precondition", "local_db_contaminated");
}

export function assertWatchRace(rowsA, rowsB, targetConnectionId) {
  const total = rowsA.length + rowsB.length;
  if (total === 0) throw new ConcurrencyFailure("race_start", "unexpected_claim_count");
  const targetRows = [...rowsA, ...rowsB].filter((row) => row[0] === targetConnectionId);
  if (targetRows.length > 1) throw new ConcurrencyFailure("identity_assertion", "duplicate_claim");
  if (targetRows.length !== 1 || total !== 1 || !targetRows[0][2]) {
    throw new ConcurrencyFailure("identity_assertion", "unexpected_claim_identity");
  }
  return targetRows[0];
}

export function assertBackupRace(rowsA, rowsB, targetConnectionId) {
  const total = rowsA.length + rowsB.length;
  if (total === 0) throw new ConcurrencyFailure("race_start", "unexpected_claim_count");
  const targetRows = [...rowsA, ...rowsB].filter((row) => row[1] === targetConnectionId);
  if (targetRows.length > 1) throw new ConcurrencyFailure("identity_assertion", "duplicate_claim");
  if (targetRows.length !== 1 || total !== 1 || !targetRows[0][0] || !targetRows[0][5] || !targetRows[0][6]) {
    throw new ConcurrencyFailure("identity_assertion", "unexpected_claim_identity");
  }
  return targetRows[0];
}

export function assertBackupLogicalRun(count, expected = 1) {
  if (count !== expected) {
    throw new ConcurrencyFailure("logical_row_assertion", count === 0 ? "expected_logical_run_missing" : "duplicate_logical_run");
  }
}
