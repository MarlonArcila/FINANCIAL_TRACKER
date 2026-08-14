# Android notification bridge

This directory contains framework-local Java source for the Capacitor Android app. It deliberately stores only sanitized candidate fields on-device and captures nothing until the user both grants Android notification access and configures an explicit package allowlist.

Run `npm run android:install-plugin -w @capitalflow/web` after `npx cap add android`. The installer copies these classes, registers the plugin in `MainActivity`, adds the listener service to the manifest, and adds the service label.

The listener does not need `POST_NOTIFICATIONS`; it reads posted notifications through the user-granted notification-listener access screen. Test on a physical Android device because notification behavior and OEM power management vary.
