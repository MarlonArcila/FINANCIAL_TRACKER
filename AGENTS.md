# AGENTS.md — CapitalFlow MVP

This repository is intended to be implemented and extended primarily with Codex or another coding agent. Treat `docs/PRD.md` and `docs/TECHNICAL_TASKS.md` as the product source of truth.

## Non-negotiable engineering rules

1. Store monetary values as integer minor units (`amount_minor`) plus a three-letter currency. Never use floating point for ledger persistence.
2. A detected notification or email is processed by the deterministic automation policy. High-confidence, non-conflicting signals may post automatically when auto-post is enabled; only ambiguous or unsafe cases remain as `transaction_candidate` exceptions for review.
3. Never send raw email bodies, raw notifications, OAuth tokens, account identifiers, card fragments, or other secrets to an AI provider.
4. Every table exposed through Supabase must have Row Level Security enabled and ownership policies tested.
5. Service-role or secret keys are server-only. Publishable keys may be exposed only with RLS enabled.
6. Every external webhook must verify its signature or validation token and be idempotent.
7. Every write path must enforce an active paid subscription, except account creation, checkout, privacy/export, and account deletion.
8. The product does not connect to bank APIs. Ingestion sources are Android notifications, Gmail, Outlook, and manual entry.
9. Investment guidance is educational scenario modeling, not a guarantee or individualized regulated advice. Calculations come from deterministic functions; AI may only explain those calculations.
10. Add or update tests whenever parser, allocation, subscription, or deduplication behavior changes.

## Repository boundaries

- `packages/core`: deterministic domain logic, parsers, calculations, no network or framework dependencies.
- `apps/web`: React PWA and Capacitor-facing UI.
- `supabase/functions`: trusted integrations, OAuth, webhooks, entitlement checks, and AI gateway.
- `supabase/migrations`: database schema, RLS, functions, views, and seed data.
- `native/android`: Java notification listener and Capacitor plugin source to copy into the generated Android project.

## Definition of done

A task is done only when its acceptance criteria pass, type checking succeeds, relevant tests pass, secrets are not committed, RLS is present, and the implementation is documented in the corresponding task row.

## Data portability invariants

- File import (CSV/TSV/TXT/XLSX/XLS/JSON) is available to weekly and annual paid plans.
- Cloud backup/restore is annual-only and backend-enforced with `assertAnnualEntitled`.
- Never persist original imported spreadsheet bytes; persist normalized ledger rows plus import metadata/hash.
- Preserve `import_key` idempotency and server-side validation.
- Google backup must use `drive.appdata`/`appDataFolder`; OneDrive must use `Files.ReadWrite.AppFolder`.
- `capitalflow-backup-v2` must exclude Whop entitlements, OAuth tokens, webhook secrets, raw mail/source events and AI text.
- Restore must validate checksum, create `pre_restore`, require `RESTAURAR`, and run through the transactional database restore function.


## Autonomy and onboarding invariants

- Treat low user intervention as an internal engineering objective, never as a user-facing percentage, KPI, badge, progress value, or marketing promise.
- Do not query or expose `private.automation_metrics_30d` from the client. It is service-role QA telemetry only.
- The onboarding must persist through OAuth redirects/restarts and configure currencies, one primary account, at least one email source, Android notification access when native, and up to 3–5 real calibration examples when available.
- Gmail/Outlook OAuth callbacks must enqueue an initial sync automatically.
- An empty Android package allow-list means local automatic discovery; only parsed financial signals leave the device.
- Every accepted exception may teach account/category rules; after learning or creating an account, reprocess recent pending candidates so the user does not answer the same question repeatedly.

## Account-plan invariants

- Weekly plan: exactly one active primary tracking account; creating/restoring a second active account must fail in backend/database enforcement.
- Annual plan: one primary plus secondary `trip`, `work`, `shared`, `project`, or `other` accounts.
- The primary account cannot be archived. Secondary annual accounts may be archived/restored without deleting history.
- `account-manage` is the trusted creation/archive/restore boundary; UI hiding alone is never entitlement enforcement.
- Cloud backups must include both active and archived account rows and preserve `is_primary`, `purpose`, `purpose_label`, and `archived_at`.
