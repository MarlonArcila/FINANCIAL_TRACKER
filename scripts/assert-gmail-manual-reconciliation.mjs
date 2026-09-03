import fs from 'node:fs';

const sync = fs.readFileSync('supabase/functions/gmail-sync/index.ts', 'utf8');
const gmail = fs.readFileSync('supabase/functions/_shared/gmail.ts', 'utf8');

function requireMatch(ok, message) {
  if (!ok) throw new Error(message);
}

requireMatch(
  sync.includes('enqueueMailSync(service, connection.id, "gmail", null)'),
  'manual gmail sync must enqueue reconciliation/backfill intent',
);
requireMatch(
  sync.includes('last_sync_at: null'),
  'manual gmail sync must force bounded recent reconciliation',
);
requireMatch(
  !sync.includes('enqueueMailSync(service, connection.id, "gmail", connection.cursor)'),
  'manual gmail sync must not depend only on history cursor',
);
for (const term of ['compra','pago','abono','transferencia','charged','purchase','received','transaction']) {
  requireMatch(gmail.includes(term), `default Gmail reconciliation query missing ${term}`);
}
requireMatch(gmail.includes('messageIds.slice(0, 100)'), 'reconciliation must remain bounded to 100 messages');
requireMatch(gmail.includes('ingestCandidate'), 'reconciliation must preserve ingestion/deduplication path');
console.log('GMAIL_MANUAL_RECONCILIATION_CONTRACT=PASS');
