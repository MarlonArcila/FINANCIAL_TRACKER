# CapitalFlow MVP

CapitalFlow is a paid personal-finance tracker delivered as:

- an installable Progressive Web App for browser use;
- an Android APK built with Capacitor for native notification access;
- a Supabase backend for authentication, PostgreSQL, Row Level Security, OAuth integrations, webhooks, and server functions.

The reference implementation supports a persistent automation-first onboarding, manual and automated transactions, portable imports from CSV/TSV/Excel/JSON, custom categories, goals and investments, deterministic allocation guidance, an optional annual AI explanation layer, Android notification ingestion, Gmail/Outlook ingestion, multi-currency reporting, Whop weekly/annual subscriptions, one primary tracking account on weekly, annual-only independent trip/work/project accounts, and annual-only cloud backup/restore through Google Drive or OneDrive.

## Important platform constraint

A browser-only PWA cannot read notifications posted by other Android applications. Android notification ingestion therefore lives in a native `NotificationListenerService` packaged with the Capacitor APK. The same React application remains usable as a normal PWA when that native capability is absent.

## Repository map

- `docs/PRD.md` — complete product requirements document.
- `docs/TECHNICAL_TASKS.md` — requirement-to-file implementation backlog.
- `docs/ARCHITECTURE.md` — system design and data flows.
- `docs/DEPLOYMENT.md` — web, Supabase, OAuth, Whop, and Android deployment.
- `docs/AI_BUILDER_HANDOFF.md` — portable instructions for Codex, Lovable, Replit, Base44, or similar tools.
- `docs/IMPLEMENTATION_STATUS.md` — implemented scope, verification evidence, and external setup still required.
- `docs/DATA_PORTABILITY_BACKUP.md` — import formats, cloud backup/restore security model and provider extension points.
- `docs/ONBOARDING_ACCOUNTS_AUTONOMY.md` — automatic onboarding, calibration, annual multi-account behavior, downgrade rules, and internal autonomy principles.
- `packages/core` — framework-free parsing and financial calculation library.
- `apps/web` — React/Vite PWA.
- `supabase` — database migrations and Edge Functions.
- `native/android` — Java plugin/service source.

## Local start

```bash
cp .env.example .env.local
npm install
npm run test:all
npm run dev
```

The UI can run in local development with `VITE_DEV_BYPASS_SUBSCRIPTION=true`, but this flag must never be enabled in production.

## Android start

```bash
npm run build
npm install -w @capitalflow/web @capacitor/cli @capacitor/android
npm exec -w @capitalflow/web cap add android
npm run android:install-plugin -w @capitalflow/web
npm exec -w @capitalflow/web cap sync android
npm exec -w @capitalflow/web cap open android
```

Generate a signed APK in Android Studio or use the Capacitor build command described in `docs/DEPLOYMENT.md`.

## Scope note

This repository is a production-oriented MVP starter. External credentials, provider registrations, legal/privacy review, Gmail restricted-scope verification, Google Drive app-data consent, Microsoft Graph app-folder permissions, Whop product configuration, and Android signing keys must be supplied by the product owner before production launch.

The repository includes GitHub Actions for dependency installation, all tests, strict workspace type checking, and a production PWA build. The generated Android project is intentionally not committed; Capacitor creates it from the web build and the checked-in native module.


## Plan/account boundary

- **Weekly:** one active primary tracking account, full ingestion/automation/import capability, no AI, no cloud backup/restore.
- **Annual:** primary account plus independent temporary/project accounts, per-account dashboard/ledger views, AI features, and cloud backup/restore.
- Archiving a secondary account is non-destructive; active and archived accounts remain part of the annual backup document.
- Automation-rate telemetry is internal QA data only and is intentionally absent from the dashboard and user settings.
