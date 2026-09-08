#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for cmd in git node npm gh vercel supabase sha256sum awk; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "DOCTOR=FAIL missing_command=$cmd"; exit 2; }
done

export VERCEL_ORG_ID="${VERCEL_ORG_ID:-team_kEkHBgTOZGxgAqPirhff6vjF}"
export VERCEL_PROJECT_ID="${VERCEL_PROJECT_ID:-prj_ae2AxB0vPQfcFDorYlDl1lfoHYZr}"

node scripts/assert-web-bootstrap-session.mjs
node scripts/assert-execution-contract.mjs

BEFORE="$(git status --porcelain=v1 --untracked-files=all | sha256sum | awk '{print $1}')"
capture_probe() {
  local out="$1"
  shift
  if "$@" > "$out" 2>&1; then
    printf '0\n' > "${out}.rc"
  else
    printf '%s\n' "$?" > "${out}.rc"
  fi
}
capture_probe "$TMP/vercel-version.txt" vercel --version
capture_probe "$TMP/vercel-env-help.txt" vercel env --help
capture_probe "$TMP/vercel-deploy-help.txt" vercel deploy --help
capture_probe "$TMP/vercel-curl-help.txt" vercel curl --help
capture_probe "$TMP/supabase-version.txt" supabase --version
capture_probe "$TMP/supabase-api-keys-help.txt" supabase projects api-keys --help
vercel env pull "$TMP/vercel-production.env" --environment=production --yes --scope arcilalarrea-3167 >/dev/null 2>&1
AFTER="$(git status --porcelain=v1 --untracked-files=all | sha256sum | awk '{print $1}')"
[[ "$BEFORE" == "$AFTER" ]] || { echo "DOCTOR=FAIL external_cli_mutated_repository"; exit 3; }

node --input-type=module - "$TMP/vercel-production.env" xxmbqbnryhvybhlwivgq <<'NODE_EOF'
import fs from "node:fs";
const [file, projectRef] = process.argv.slice(2);
const text = fs.readFileSync(file, "utf8");
const vars = {};
for (const raw of text.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i < 1) continue;
  const name = line.slice(0, i).trim();
  let value = line.slice(i + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  vars[name] = value;
}
function classify(value) {
  if (!value || value.startsWith("sb_secret_")) return null;
  if (value.startsWith("sb_publishable_")) return "publishable";
  if (!value.startsWith("eyJ")) return null;
  try {
    const payload = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8"));
    if (payload.role !== "anon") return null;
    if (payload.ref && payload.ref !== projectRef) return null;
    return "legacy_anon";
  } catch { return null; }
}
if (vars.VITE_SUPABASE_URL !== `https://${projectRef}.supabase.co`) {
  console.error("DOCTOR=FAIL invalid_VITE_SUPABASE_URL");
  process.exit(4);
}
const mode = classify(vars.VITE_SUPABASE_PUBLISHABLE_KEY) || classify(vars.VITE_SUPABASE_ANON_KEY);
if (!mode) {
  console.error("DOCTOR=FAIL missing_or_unsafe_public_Supabase_browser_key");
  process.exit(5);
}
console.log(`DOCTOR_SUPABASE_BROWSER_ENV=PASS mode=${mode}`);
NODE_EOF

echo "DOCTOR_VERCEL_EXPLICIT_PROJECT_TARGETING=PASS"
echo "DOCTOR_EXTERNAL_CLI_NO_REPO_MUTATION=PASS"
echo "DOCTOR=PASS"
