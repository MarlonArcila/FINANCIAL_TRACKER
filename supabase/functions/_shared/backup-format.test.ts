import test from "node:test";
import assert from "node:assert/strict";

import { BACKUP_TABLES, parseBackupDocument, sha256Hex } from "./backup-format.ts";

function validDocument() {
  return {
    format: "capitalflow-backup-v2",
    generatedAt: "2026-08-13T12:00:00.000Z",
    data: Object.fromEntries([["profile", { id: "user" }], ...BACKUP_TABLES.map((table) => [table, []])]),
    excluded: [],
  };
}

test("backup v2 validates required collections", () => {
  const document = parseBackupDocument(JSON.stringify(validDocument()));
  assert.equal(document.format, "capitalflow-backup-v2");
});

test("backup rejects missing tables", () => {
  const document = validDocument();
  delete document.data.transactions;
  assert.throws(() => parseBackupDocument(JSON.stringify(document)), /falta transactions/u);
});

test("backup checksum is stable", async () => {
  assert.equal(await sha256Hex("CapitalFlow"), await sha256Hex("CapitalFlow"));
  assert.notEqual(await sha256Hex("CapitalFlow"), await sha256Hex("capitalflow"));
});
