#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
: "${CAPACITOR_APP_ID:?CAPACITOR_APP_ID is required}"
: "${ANDROID_KEYSTORE_PATH:?ANDROID_KEYSTORE_PATH is required}"
: "${ANDROID_KEYSTORE_PASSWORD:?ANDROID_KEYSTORE_PASSWORD is required}"
: "${ANDROID_KEY_ALIAS:?ANDROID_KEY_ALIAS is required}"
: "${ANDROID_KEY_PASSWORD:?ANDROID_KEY_PASSWORD is required}"
[[ -f "$ANDROID_KEYSTORE_PATH" ]] || { echo "STOP: android_keystore_not_found" >&2; exit 1; }
command -v java >/dev/null || { echo "STOP: java_not_found" >&2; exit 1; }
command -v jarsigner >/dev/null || { echo "STOP: jarsigner_not_found" >&2; exit 1; }

if [[ -d apps/web/android ]]; then
  EXISTING_APP_ID="$(grep -RhoE 'applicationId[[:space:]]+["\x27][^"\x27]+["\x27]' apps/web/android/app/build.gradle* 2>/dev/null | head -1 | sed -E 's/.*["\x27]([^"\x27]+)["\x27].*/\1/' || true)"
  if [[ -n "$EXISTING_APP_ID" && "$EXISTING_APP_ID" != "$CAPACITOR_APP_ID" ]]; then
    rm -rf apps/web/android
  fi
fi
if [[ ! -d apps/web/android ]]; then
  npm run build
  npm exec -w @capitalflow/web cap add android
fi
npm run android:install-plugin -w @capitalflow/web
npm exec -w @capitalflow/web cap sync android

VERSION_CODE="${ANDROID_VERSION_CODE:-$(git rev-list --count HEAD)}"
VERSION_NAME="${ANDROID_VERSION_NAME:-0.1.0-$(git rev-parse --short=12 HEAD)}"
[[ "$VERSION_CODE" =~ ^[1-9][0-9]*$ ]] || { echo "STOP: invalid_android_version_code" >&2; exit 1; }
GRADLE_FILE="$(find apps/web/android/app -maxdepth 1 -type f \( -name 'build.gradle' -o -name 'build.gradle.kts' \) -print -quit)"
[[ -n "$GRADLE_FILE" ]] || { echo "STOP: app_gradle_not_found" >&2; exit 1; }
python3 - "$GRADLE_FILE" "$VERSION_CODE" "$VERSION_NAME" <<'PY2'
from pathlib import Path
import re
import sys
p = Path(sys.argv[1])
code = sys.argv[2]
name = sys.argv[3]
s = p.read_text()
if re.search(r"versionCode\s*=\s*\d+", s):
    s = re.sub(r"versionCode\s*=\s*\d+", f"versionCode = {code}", s, count=1)
elif re.search(r"versionCode\s+\d+", s):
    s = re.sub(r"versionCode\s+\d+", f"versionCode {code}", s, count=1)
else:
    raise SystemExit("versionCode not found")
if re.search(r'versionName\s*=\s*"[^"]*"', s):
    s = re.sub(r'versionName\s*=\s*"[^"]*"', f'versionName = "{name}"', s, count=1)
elif re.search(r'versionName\s+"[^"]*"', s):
    s = re.sub(r'versionName\s+"[^"]*"', f'versionName "{name}"', s, count=1)
else:
    raise SystemExit("versionName not found")
p.write_text(s)
PY2

BUILD_TOOLS="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}/build-tools"
[[ -d "$BUILD_TOOLS" ]] || { echo "STOP: android_build_tools_not_found" >&2; exit 1; }
LATEST_TOOLS="$(find "$BUILD_TOOLS" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
ZIPALIGN="$LATEST_TOOLS/zipalign"
APKSIGNER="$LATEST_TOOLS/apksigner"
[[ -x "$ZIPALIGN" ]] || { echo "STOP: zipalign_not_found" >&2; exit 1; }
[[ -x "$APKSIGNER" ]] || { echo "STOP: apksigner_not_found" >&2; exit 1; }

(
  cd apps/web/android
  ./gradlew --no-daemon clean assembleRelease bundleRelease
)

UNSIGNED_APK="apps/web/android/app/build/outputs/apk/release/app-release-unsigned.apk"
SOURCE_AAB="apps/web/android/app/build/outputs/bundle/release/app-release.aab"
[[ -f "$UNSIGNED_APK" ]] || { echo "STOP: unsigned_release_apk_not_found" >&2; exit 1; }
[[ -f "$SOURCE_AAB" ]] || { echo "STOP: release_aab_not_found" >&2; exit 1; }

mkdir -p artifacts
SHA="$(git rev-parse --short=12 HEAD)"
ALIGNED="artifacts/capitalflow-${SHA}-aligned.apk"
SIGNED_APK="artifacts/capitalflow-${SHA}-release.apk"
SIGNED_AAB="artifacts/capitalflow-${SHA}-play.aab"

"$ZIPALIGN" -f -p 4 "$UNSIGNED_APK" "$ALIGNED"
"$APKSIGNER" sign \
  --ks "$ANDROID_KEYSTORE_PATH" \
  --ks-key-alias "$ANDROID_KEY_ALIAS" \
  --ks-pass env:ANDROID_KEYSTORE_PASSWORD \
  --key-pass env:ANDROID_KEY_PASSWORD \
  --out "$SIGNED_APK" \
  "$ALIGNED"
"$APKSIGNER" verify --verbose --print-certs "$SIGNED_APK"
rm -f "$ALIGNED"

cp "$SOURCE_AAB" "$SIGNED_AAB"
jarsigner \
  -keystore "$ANDROID_KEYSTORE_PATH" \
  -storepass:env ANDROID_KEYSTORE_PASSWORD \
  -keypass:env ANDROID_KEY_PASSWORD \
  "$SIGNED_AAB" "$ANDROID_KEY_ALIAS"
jarsigner -verify -verbose -certs "$SIGNED_AAB" >/dev/null

APK_SHA256="$(sha256sum "$SIGNED_APK" | awk '{print $1}')"
AAB_SHA256="$(sha256sum "$SIGNED_AAB" | awk '{print $1}')"
printf '%s  %s\n' "$APK_SHA256" "$SIGNED_APK" >"${SIGNED_APK}.sha256"
printf '%s  %s\n' "$AAB_SHA256" "$SIGNED_AAB" >"${SIGNED_AAB}.sha256"
printf 'SIGNED_APK=%s\nSIGNED_APK_SHA256=%s\nSIGNED_AAB=%s\nSIGNED_AAB_SHA256=%s\nANDROID_APP_ID=%s\nANDROID_VERSION_CODE=%s\nANDROID_VERSION_NAME=%s\nANDROID_DISTRIBUTION_ARTIFACTS=GREEN\n' \
  "$SIGNED_APK" "$APK_SHA256" "$SIGNED_AAB" "$AAB_SHA256" "$CAPACITOR_APP_ID" "$VERSION_CODE" "$VERSION_NAME"
