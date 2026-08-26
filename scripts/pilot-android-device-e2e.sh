#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
APK="${PILOT_APK_PATH:-}"
APP_ID="${CAPACITOR_APP_ID:-}"
[[ -n "$APK" && -f "$APK" ]] || { echo "STOP: PILOT_APK_PATH_REQUIRED" >&2; exit 1; }
[[ "$APP_ID" =~ ^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*){2,}$ ]] || { echo "STOP: CAPACITOR_APP_ID_INVALID" >&2; exit 1; }
[[ "$APP_ID" != com.example.* ]] || { echo "STOP: EXAMPLE_ANDROID_APP_ID_NOT_ALLOWED" >&2; exit 1; }
command -v adb >/dev/null || { echo "STOP: adb_not_found" >&2; exit 1; }
APKSIGNER="$(command -v apksigner || true)"
if [[ -z "$APKSIGNER" ]]; then
  BUILD_TOOLS="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}/build-tools"
  [[ -d "$BUILD_TOOLS" ]] && APKSIGNER="$(find "$BUILD_TOOLS" -mindepth 2 -maxdepth 2 -type f -name apksigner | sort -V | tail -1)"
fi
[[ -n "$APKSIGNER" && -x "$APKSIGNER" ]] || { echo "STOP: apksigner_not_found" >&2; exit 1; }
"$APKSIGNER" verify --verbose --print-certs "$APK"
SERIAL="${ANDROID_SERIAL:-}"
if [[ -z "$SERIAL" ]]; then
  mapfile -t DEVICES < <(adb devices | awk 'NR>1 && $2=="device" {print $1}')
  [[ "${#DEVICES[@]}" -eq 1 ]] || { printf 'STOP: expected_one_authorized_android_device found=%s\n' "${#DEVICES[@]}" >&2; exit 1; }
  SERIAL="${DEVICES[0]}"
fi
ADB=(adb -s "$SERIAL")
"${ADB[@]}" get-state | grep -qx device || { echo "STOP: android_device_not_ready" >&2; exit 1; }
"${ADB[@]}" install -r "$APK" >/dev/null
"${ADB[@]}" shell pm path "$APP_ID" | grep -q '^package:' || { echo "STOP: apk_not_installed" >&2; exit 1; }
"${ADB[@]}" shell dumpsys package "$APP_ID" | grep -q 'com.capitalflow.notification.FinanceNotificationListenerService' || { echo "STOP: notification_listener_service_missing" >&2; exit 1; }
"${ADB[@]}" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
ENABLED="$("${ADB[@]}" shell settings get secure enabled_notification_listeners 2>/dev/null | tr -d '\r')"
if [[ "$ENABLED" != *"$APP_ID"* ]]; then
  echo "ANDROID_ACTION=ENABLE_NOTIFICATION_ACCESS_FOR_$APP_ID"
  "${ADB[@]}" shell am start -a android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS >/dev/null 2>&1 || true
  for _ in $(seq 1 60); do
    sleep 3
    ENABLED="$("${ADB[@]}" shell settings get secure enabled_notification_listeners 2>/dev/null | tr -d '\r')"
    [[ "$ENABLED" == *"$APP_ID"* ]] && break
  done
fi
[[ "$ENABLED" == *"$APP_ID"* ]] || { echo "STOP: notification_listener_not_enabled" >&2; exit 1; }
"${ADB[@]}" shell cmd notification post -S bigtext -t 'Compra aprobada' capitalflow-pilot-e2e 'Compra por COP 12345 en PILOT TEST' >/dev/null 2>&1 || echo "ANDROID_SYNTHETIC_NOTIFICATION=UNAVAILABLE_ON_DEVICE"
echo "ANDROID_ACTION=OPEN_CAPITALFLOW_AND_CONFIRM_THE_SYNTHETIC_COP_12345_CANDIDATE"
if [[ "${CF_ANDROID_NOTIFICATION_E2E_CONFIRMED:-}" != "true" ]]; then
  if [[ -t 0 ]]; then
    read -r -p "Escribe YES solo si CapitalFlow detectó la notificación financiera en el dispositivo: " CONFIRM
    [[ "$CONFIRM" == "YES" ]] || { echo "STOP: android_notification_e2e_not_confirmed" >&2; exit 1; }
  else
    echo "STOP: CF_ANDROID_NOTIFICATION_E2E_CONFIRMED=true_REQUIRED_IN_NONINTERACTIVE_MODE" >&2
    exit 1
  fi
fi
printf 'ANDROID_SERIAL=%s\nANDROID_APP_ID=%s\nSIGNED_ANDROID_DEVICE_E2E=GREEN\n' "$SERIAL" "$APP_ID"
