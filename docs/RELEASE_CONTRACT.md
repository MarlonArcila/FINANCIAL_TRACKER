# CapitalFlow execution and release contract

This document is the authoritative contract for repository automation, external-tool integration, preview validation, merge, and production release. Product/domain requirements remain in the PRD and technical tasks, but runtime/release facts here take precedence over older handoffs, historical runners, or prior chat checkpoints.

## 1. Source-of-truth order

When facts disagree, use this order:

1. Current repository state on the target branch and its tests.
2. Live CLI help from the installed tool (`--help`) for syntax and supported flags.
3. Current official vendor documentation for behavior and security guidance.
4. Current remote state in GitHub, Vercel, Supabase, and Cloudflare.
5. Prior checkpoints, chat history, old runners, and old handoffs only as historical evidence.

Never encode a transient tool side effect as a required invariant. A repair must inspect the actual current state and accept equivalent safe states. The absence of a previously observed `.gitignore` mutation, redirect, local metadata file, or other transient effect is not itself an error.

## 2. Canonical production identifiers

- GitHub repository: `MarlonArcila/FINANCIAL_TRACKER`
- Vercel team ID: `team_kEkHBgTOZGxgAqPirhff6vjF`
- Vercel team slug: `arcilalarrea-3167`
- Vercel project ID: `prj_ae2AxB0vPQfcFDorYlDl1lfoHYZr`
- Canonical web URL: `https://capitalflow-pilot.vercel.app`
- Supabase project ref: `xxmbqbnryhvybhlwivgq`

Long-lived automation resolves the current `main` SHA at runtime. Historical SHAs are evidence, not permanent configuration.

## 3. Current Integrations surface

The active user-facing Integrations surface exposes only the automatic Email Relay. One shared private CapitalFlow alias may receive forwarded financial notices from Gmail, Outlook/Hotmail, Proton Mail, or another provider.

Legacy Gmail OAuth and Android notification-ingestion code may remain in the repository for rollback/compatibility, but backend code is not proof that a feature is active in the UI. Those legacy integrations must not be re-exposed unless a new explicit product decision reactivates them.

## 4. Supabase browser configuration

The browser client uses:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` as the preferred public browser key
- `VITE_SUPABASE_ANON_KEY` only as a legacy compatibility fallback

Never put `service_role`, `SUPABASE_SERVICE_ROLE_KEY`, `sb_secret_*`, or another elevated backend credential in a `VITE_*` variable or browser bundle. Publishable keys are intentionally public; user/data authorization remains enforced by Supabase Auth and RLS.

Session initialization is bounded. A slow or failed `getSession()` call must not leave the application on an infinite loading screen. `onAuthStateChange` callbacks must not perform asynchronous Supabase API calls.

## 5. Vercel automation contract

Automated isolated runs target the existing Vercel project using `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`; they do not establish project linkage inside the repository. Environment pulls go to temporary files outside the repository.

Before using release-sensitive Vercel CLI behavior, capture the installed version and relevant `--help` output. Help/version probes are advisory discovery: a non-zero nested `--help` exit must be recorded, not treated as a release failure by itself. Gate only on a capability that the current phase actually needs. A protected preview is tested with `vercel curl ... --deployment <preview-url>`. Anonymous raw `curl` is not a valid protected-preview smoke test.

Production deploys come only from the merged `main` commit. After deploy, the canonical production URL must be checked; a READY deployment-specific URL alone is insufficient release evidence.

## 6. Repair-runner design contract

A repair/release runner must:

- leave the user's original dirty worktree untouched;
- create a fresh isolated clone/worktree from current remote state;
- inspect current repository structure before writing;
- discover current CLI behavior rather than guessing flags;
- use structured/semantic edits, or a complete rewrite only for a small module after explicit structural preconditions;
- compare actual changed paths against an allowlist;
- accept zero side effects and other equivalent safe states instead of requiring a transient artifact;
- stop on unrelated tracked mutations rather than deleting or hiding them;
- use `npm ci` when `package-lock.json` exists;
- run change-based local validation, then required CI on the exact PR head;
- revalidate PR head/state/mergeability immediately before merge;
- deploy only the merged `main` SHA;
- never print OAuth tokens, secret keys, service-role credentials, or other backend secrets into logs/evidence.

## 7. Required preflight

Static/CI-safe contract:

```bash
npm run test:web-bootstrap
npm run test:execution-contract
```

Authenticated release-workstation doctor:

```bash
npm run doctor:release
```

## 8. Financial Sources and forwarding verification

The visible section name is **Fuentes Financieras**. Its sole active user-facing mail integration remains the automatic Email Relay; this does not reactivate Gmail OAuth, Microsoft Graph, or Android ingestion.

A relay alias uses a high-entropy token that is stored only as a hash. The full `cf+…@ingest.capitalflow.eu.cc` address is returned only by create/rotate and shown in memory once. Later state responses expose only the alias hint. Verification URLs, codes, and excerpts are temporary setup material: the private forwarding-verification inbox retains actionable material for at most seven days and clears it on resolution, dismissal, expiration, alias revocation, or source revocation.

The inbox is provider-neutral (`gmail`, `outlook`, `proton`, `other`), but only Gmail has a currently verified detector. Gmail links are actionable only after HTTPS and Google-owned-host allowlisting; no arbitrary mail link or mail HTML is rendered. A confirmation is an ignored non-financial source event and never enters the parser/candidate/transaction pipeline. Future providers require documented behavior or captured fixtures before adding a detector.

When this surface changes, release in compatibility order: merge additive migration, apply it to the linked production project, deploy only changed `email-relay-ingest` and `email-relay-settings` functions, smoke their authenticated/runtime boundary, then deploy the exact merged `main` SHA to the canonical Vercel project. The Gmail forwarding guide must continue to recommend a verified address plus a financial-only Gmail filter, never global forwarding of a whole mailbox.

## 9. Email Routing prerequisite

The relay contract requires Cloudflare Email Routing to be enabled and ready for `ingest.capitalflow.eu.cc`, with subaddressing enabled, and a `cf@ingest.capitalflow.eu.cc` routing rule targeting `capitalflow-email-relay`. The worker must preserve the `cf+TOKEN` recipient detail without logging it. The authenticated release doctor/operator must verify these live facts before a real forwarding UAT; static CI verifies this contract but never stores Cloudflare credentials.


## 10. Email Relay V4 security and linking contract

- A provider selection is a short-lived private setup intent, never a trusted source. Sources are registered only from authenticated inbound evidence; the current safety model limits a shared alias to one active source per provider until reliable per-account evidence is available.
- The browser receives one normalized verification action only: safe_url, code, safe_url_and_code, or instructions_only. It may mark an action opened or dismiss it, but cannot resolve provider verification or activate a source.
- Provider hints are diagnostic only. A clickable verification action requires authenticated provider evidence and a narrow HTTPS confirmation path; no verification URL is prefetched.
- A source becomes active only after a forwarding-path proof. Direct mail to the alias, non-financial mail, inactive subscription traffic, and browser clicks cannot activate it. Inactive subscription traffic is rejected before MIME parsing/body persistence.
- Verification URL/code/excerpt are temporary: max seven days, cleared on dismissal/expiry/revocation. Raw MIME is transient only; parsed body storage is bounded and operational metadata never includes a verification URL, code, or alias token.
- The Worker has an HTTPS Supabase gateway allowlist, HMAC nonce/timestamp signing, bounded payload and fetch timeout. x-capitalflow-key-id is sent for an overlap-ready HMAC rotation; do not rotate a production secret merely for a code release.
- Release order remains: merge, additive migration, deploy changed relay Edge Functions, deploy Worker if changed, exact merged Vercel production deployment, then smoke. Manual Gmail confirmation and link-test UAT is last.
