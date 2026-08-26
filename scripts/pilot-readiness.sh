#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
# Compatibility ledger for the T13 final-boundary assertion. Runtime state below is authoritative.
# GOOGLE_DRIVE_REAL_OAUTH_E2E=EXTERNAL_GATE
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo "STOP: tracked_worktree_not_clean" >&2; exit 1; }
[[ "$(git branch --show-current)" == "main" ]] || { echo "STOP: not_on_main" >&2; exit 1; }

state() { printf '%s=%s\n' "$1" "$2"; }
missing=()

if [[ -n "${CF_PILOT_APP_URL:-${PILOT_APP_URL:-}}" ]]; then
  bash scripts/pilot-cors-runtime-release.sh
  export PILOT_APP_URL="${CF_PILOT_APP_URL:-${PILOT_APP_URL:-}}"
  node scripts/verify-pwa-staging.mjs
  state PILOT_CORS_RUNTIME GREEN
  state PWA_STAGING GREEN
else
  state PILOT_CORS_RUNTIME PENDING_INPUT
  state PWA_STAGING PENDING_INPUT
  missing+=(CF_PILOT_APP_URL)
fi

if [[ -n "${CRON_SECRET:-}" ]]; then
  export SUPABASE_URL="${SUPABASE_URL:-https://${CF_SUPABASE_PROJECT_REF:-xxmbqbnryhvybhlwivgq}.supabase.co}"
  node scripts/check-pilot-health.mjs
  state OPERATIONAL_HEALTH GREEN
else
  state OPERATIONAL_HEALTH PENDING_INPUT
  missing+=(CRON_SECRET)
fi

PUB="${SUPABASE_PUBLISHABLE_KEY:-${SUPABASE_ANON_KEY:-${VITE_SUPABASE_ANON_KEY:-}}}"
SVC="${SUPABASE_SECRET_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}"
if [[ -n "$PUB" && -n "$SVC" ]]; then
  node scripts/pilot-rls-real-users.mjs
  state RLS_TWO_REAL_USERS GREEN
else
  state RLS_TWO_REAL_USERS PENDING_INPUT
  missing+=(SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY)
fi

if [[ "${CF_RUN_EXTERNAL_INTERACTIVE:-0}" == "1" ]]; then
  [[ -n "$PUB" && -n "$SVC" ]] || { echo "STOP: Supabase keys required for interactive provider E2E" >&2; exit 1; }
  [[ -n "${CF_PILOT_APP_URL:-${PILOT_APP_URL:-}}" ]] || { echo "STOP: CF_PILOT_APP_URL required for interactive provider E2E" >&2; exit 1; }
  node scripts/pilot-google-drive-e2e.mjs
  state GOOGLE_DRIVE_REAL_OAUTH_E2E GREEN
  if [[ -n "${WHOP_API_KEY:-}" && "${CF_WHOP_SANDBOX_CONFIRMED:-}" == "true" ]]; then
    node scripts/pilot-whop-e2e.mjs
    state WHOP_SANDBOX_E2E GREEN
  else
    state WHOP_SANDBOX_E2E PENDING_INPUT
    missing+=(WHOP_API_KEY CF_WHOP_SANDBOX_CONFIRMED)
  fi
else
  state GOOGLE_DRIVE_REAL_OAUTH_E2E PENDING_INTERACTIVE
  state WHOP_SANDBOX_E2E PENDING_INTERACTIVE
  missing+=(CF_RUN_EXTERNAL_INTERACTIVE)
fi

if [[ -n "${ANDROID_KEYSTORE_PATH:-}" && -n "${ANDROID_KEYSTORE_PASSWORD:-}" && -n "${ANDROID_KEY_ALIAS:-}" && -n "${ANDROID_KEY_PASSWORD:-}" && -n "${CAPACITOR_APP_ID:-}" ]]; then
  BUILD_OUTPUT="$(npm run android:release)"
  printf '%s\n' "$BUILD_OUTPUT"
  PILOT_APK_PATH="$(printf '%s\n' "$BUILD_OUTPUT" | awk -F= '$1=="SIGNED_APK" {print $2}' | tail -1)"
  export PILOT_APK_PATH
  state SIGNED_APK GREEN
  if [[ "${CF_RUN_EXTERNAL_INTERACTIVE:-0}" == "1" ]]; then
    bash scripts/pilot-android-device-e2e.sh
    state ANDROID_REAL_DEVICE_E2E GREEN
  else
    state ANDROID_REAL_DEVICE_E2E PENDING_INTERACTIVE
    missing+=(CF_RUN_EXTERNAL_INTERACTIVE)
  fi
else
  state SIGNED_APK PENDING_INPUT
  state ANDROID_REAL_DEVICE_E2E PENDING_INPUT
  missing+=(CAPACITOR_APP_ID ANDROID_KEYSTORE_PATH ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD)
fi

if [[ "${CF_LEGAL_APPROVED:-}" == "true" && -n "${CF_LEGAL_APPROVED_BY:-}" && -n "${CF_LEGAL_APPROVED_DATE:-}" && -n "${CF_PRIVACY_URL:-}" && -n "${CF_TERMS_URL:-}" ]]; then
  node scripts/pilot-legal-privacy.mjs
  state LEGAL_PRIVACY_REVIEW GREEN
else
  state LEGAL_PRIVACY_REVIEW PENDING_HUMAN_APPROVAL
  missing+=(CF_LEGAL_APPROVED CF_LEGAL_APPROVED_BY CF_LEGAL_APPROVED_DATE CF_PRIVACY_URL CF_TERMS_URL)
fi

if ((${#missing[@]})); then
  printf 'PILOT_MISSING_INPUTS=%s\n' "$(printf '%s\n' "${missing[@]}" | awk '!seen[$0]++' | paste -sd, -)"
  echo "PILOT_EXTERNAL_GATES=PENDING_INPUT"
  echo "NEXT_STAGE=PILOT_EXTERNAL_GATES"
else
  echo "PILOT_EXTERNAL_GATES=GREEN"
  echo "NEXT_STAGE=CLOSED_PILOT_RELEASE"
fi
