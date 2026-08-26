#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
: "${ANDROID_KEYSTORE_PATH:?ANDROID_KEYSTORE_PATH is required}"
: "${ANDROID_KEYSTORE_PASSWORD:?ANDROID_KEYSTORE_PASSWORD is required}"
: "${ANDROID_KEY_ALIAS:?ANDROID_KEY_ALIAS is required}"
: "${ANDROID_KEY_PASSWORD:?ANDROID_KEY_PASSWORD is required}"
[[ -f "$ANDROID_KEYSTORE_PATH" ]] || { echo "STOP: android_keystore_not_found" >&2; exit 1; }
command -v java >/dev/null || { echo "STOP: java_not_found" >&2; exit 1; }

if [[ ! -d apps/web/android ]]; then
  npm run build
  npm exec -w @capitalflow/web cap add android
fi
npm run android:install-plugin -w @capitalflow/web
npm exec -w @capitalflow/web cap sync android

BUILD_TOOLS="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}/build-tools"
[[ -d "$BUILD_TOOLS" ]] || { echo "STOP: android_build_tools_not_found" >&2; exit 1; }
LATEST_TOOLS="$(find "$BUILD_TOOLS" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
ZIPALIGN="$LATEST_TOOLS/zipalign"
APKSIGNER="$LATEST_TOOLS/apksigner"
[[ -x "$ZIPALIGN" ]] || { echo "STOP: zipalign_not_found" >&2; exit 1; }
[[ -x "$APKSIGNER" ]] || { echo "STOP: apksigner_not_found" >&2; exit 1; }

(
  cd apps/web/android
  ./gradlew --no-daemon clean assembleRelease
)
UNSIGNED="apps/web/android/app/build/outputs/apk/release/app-release-unsigned.apk"
[[ -f "$UNSIGNED" ]] || { echo "STOP: unsigned_release_apk_not_found" >&2; exit 1; }
mkdir -p artifacts
SHA="$(git rev-parse --short=12 HEAD)"
ALIGNED="artifacts/capitalflow-${SHA}-aligned.apk"
SIGNED="artifacts/capitalflow-${SHA}-release.apk"
"$ZIPALIGN" -f -p 4 "$UNSIGNED" "$ALIGNED"
"$APKSIGNER" sign \
  --ks "$ANDROID_KEYSTORE_PATH" \
  --ks-key-alias "$ANDROID_KEY_ALIAS" \
  --ks-pass env:ANDROID_KEYSTORE_PASSWORD \
  --key-pass env:ANDROID_KEY_PASSWORD \
  --out "$SIGNED" \
  "$ALIGNED"
"$APKSIGNER" verify --verbose --print-certs "$SIGNED"
rm -f "$ALIGNED"
sha256sum "$SIGNED" | tee "${SIGNED}.sha256"
printf 'SIGNED_APK=%s\nANDROID_RELEASE_SHA=%s\nANDROID_SIGNED_APK=GREEN\n' "$SIGNED" "$(git rev-parse HEAD)"
