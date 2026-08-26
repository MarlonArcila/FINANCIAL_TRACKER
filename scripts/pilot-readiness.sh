#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
[[ -z "$(git status --porcelain)" ]] || { echo "STOP: worktree_not_clean" >&2; exit 1; }
[[ "$(git branch --show-current)" == "main" ]] || { echo "STOP: not_on_main" >&2; exit 1; }

echo "===== STATIC T13 GATES ====="
npm run test:t13-boundary
npm run typecheck
npm run build

echo "===== OPTIONAL LOCAL DATABASE GATE ====="
if [[ "${RUN_LOCAL_DB_TESTS:-0}" == "1" ]]; then
  supabase test db
  echo "LOCAL_DB_PGTAP=GREEN"
else
  echo "LOCAL_DB_PGTAP=NOT_REQUESTED"
fi

echo "===== PWA STAGING GATE ====="
if [[ -n "${PILOT_APP_URL:-}" ]]; then
  node scripts/verify-pwa-staging.mjs
else
  echo "PWA_STAGING=NEEDS_PILOT_APP_URL"
fi

echo "===== OPERATIONAL HEALTH GATE ====="
if [[ -n "${SUPABASE_URL:-}" && -n "${CRON_SECRET:-}" ]]; then
  node scripts/check-pilot-health.mjs
else
  echo "OPERATIONAL_HEALTH=NEEDS_SUPABASE_URL_AND_CRON_SECRET"
fi

echo "===== APK GATE ====="
if [[ -n "${PILOT_APK_PATH:-}" ]]; then
  [[ -f "$PILOT_APK_PATH" ]] || { echo "STOP: PILOT_APK_PATH_not_found" >&2; exit 1; }
  command -v apksigner >/dev/null || { echo "STOP: apksigner_not_found" >&2; exit 1; }
  apksigner verify --verbose --print-certs "$PILOT_APK_PATH"
  sha256sum "$PILOT_APK_PATH"
  echo "SIGNED_APK_VERIFY=GREEN"
else
  echo "SIGNED_APK_VERIFY=NEEDS_PILOT_APK_PATH"
fi

echo "RLS_TWO_REAL_USERS=EXTERNAL_GATE"
echo "GOOGLE_DRIVE_REAL_OAUTH_E2E=EXTERNAL_GATE"
echo "WHOP_SANDBOX_E2E=EXTERNAL_GATE"
echo "ANDROID_REAL_DEVICE_E2E=EXTERNAL_GATE"
echo "LEGAL_PRIVACY_REVIEW=EXTERNAL_GATE"
echo "PILOT_READINESS_CODE=GREEN"
