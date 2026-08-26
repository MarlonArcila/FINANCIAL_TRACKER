#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
PROJECT_REF="${CF_SUPABASE_PROJECT_REF:-xxmbqbnryhvybhlwivgq}"
RAW_URL="${CF_PILOT_APP_URL:-${PILOT_APP_URL:-}}"
[[ -n "$RAW_URL" ]] || { echo "STOP: CF_PILOT_APP_URL_REQUIRED" >&2; exit 1; }
ORIGIN="$(node -e 'const u=new URL(process.argv[1]); if(u.protocol!=="https:"||u.username||u.password||u.search||u.hash) process.exit(2); process.stdout.write(u.origin)' "$RAW_URL")" || { echo "STOP: PILOT_APP_URL_INVALID" >&2; exit 1; }
command -v supabase >/dev/null || { echo "STOP: supabase_not_found" >&2; exit 1; }
command -v curl >/dev/null || { echo "STOP: curl_not_found" >&2; exit 1; }

supabase secrets set "APP_URL=$ORIGIN" --project-ref "$PROJECT_REF"
mapfile -t FUNCTIONS < <(node scripts/edge-http-deploy-closure.mjs)
[[ "${#FUNCTIONS[@]}" -eq 26 ]] || { printf 'Unexpected CORS closure count: %s\n' "${#FUNCTIONS[@]}" >&2; printf '%s\n' "${FUNCTIONS[@]}" >&2; exit 1; }
printf 'EDGE_HTTP_DEPLOY_CLOSURE_COUNT=%s\n' "${#FUNCTIONS[@]}"
for fn in "${FUNCTIONS[@]}"; do
  echo "--- CORS DEPLOY $fn ---"
  supabase functions deploy "$fn" --project-ref "$PROJECT_REF"
done

ENDPOINT="https://${PROJECT_REF}.supabase.co/functions/v1/whop-webhook"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
ALLOW_CODE="$(curl -sS -D "$TMP/allow.h" -o "$TMP/allow.b" -w '%{http_code}' -X OPTIONS -H "Origin: $ORIGIN" -H 'Access-Control-Request-Method: POST' "$ENDPOINT")"
[[ "$ALLOW_CODE" == "204" ]] || { cat "$TMP/allow.h" >&2; cat "$TMP/allow.b" >&2; echo "STOP: CORS_ALLOWED_PREFLIGHT_HTTP_$ALLOW_CODE" >&2; exit 1; }
ALLOW_ORIGIN="$(awk '{ p=index($0, ":"); if (!p) next; name=tolower(substr($0,1,p-1)); if (name != "access-control-allow-origin") next; value=substr($0,p+1); sub(/\r$/, "", value); gsub(/^[[:space:]]+|[[:space:]]+$/, "", value); print value }' "$TMP/allow.h" | tail -1)"
[[ "$ALLOW_ORIGIN" == "$ORIGIN" ]] || { cat "$TMP/allow.h" >&2; echo "STOP: CORS_ALLOWED_ORIGIN_HEADER_MISMATCH" >&2; exit 1; }
EVIL="https://evil.invalid"
DENY_CODE="$(curl -sS -D "$TMP/deny.h" -o "$TMP/deny.b" -w '%{http_code}' -X OPTIONS -H "Origin: $EVIL" -H 'Access-Control-Request-Method: POST' "$ENDPOINT")"
[[ "$DENY_CODE" == "403" ]] || { cat "$TMP/deny.h" >&2; cat "$TMP/deny.b" >&2; echo "STOP: CORS_DENIED_PREFLIGHT_HTTP_$DENY_CODE" >&2; exit 1; }
if grep -Eqi '^access-control-allow-origin:' "$TMP/deny.h"; then cat "$TMP/deny.h" >&2; echo "STOP: CORS_DENIED_ORIGIN_WAS_REFLECTED" >&2; exit 1; fi
printf 'PILOT_APP_ORIGIN=%s\nT13_CORS_RUNTIME=GREEN\n' "$ORIGIN"
