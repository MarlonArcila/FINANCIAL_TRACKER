# Despliegue — CapitalFlow MVP

## 1. Ambientes

Mantenga tres ambientes aislados:

| Ambiente | Uso | Proveedores |
|---|---|---|
| local | desarrollo y pruebas unitarias | Supabase local, mocks, Whop sandbox |
| staging | piloto interno/testers | Supabase staging, OAuth testing, Whop sandbox |
| production | usuarios pagos | proyectos OAuth verificados, Whop production, dominio final |

No reutilice secretos, bases de datos, OAuth clients ni webhooks entre staging y producción.

## 2. Prerrequisitos

- Node.js 22.12 o superior.
- npm 10 o superior.
- Supabase CLI.
- Android Studio y JDK compatible con la versión de Capacitor.
- Cuenta/proyecto de Google Cloud para Gmail.
- Cuenta Whop con empresa, producto y dos planes.
- Dominio HTTPS controlado por el producto.

## 3. Desarrollo local

```bash
cp .env.example .env.local
npm install
npm run test:all
npm run typecheck
npm run dev
```

Para trabajar en UI antes de integrar Whop:

```env
VITE_DEV_BYPASS_SUBSCRIPTION=true
```

Este valor debe ser `false` o inexistente en staging/production.

## 4. Supabase

### 4.1 Inicializar y aplicar migraciones

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Para local:

```bash
supabase start
supabase db reset
```

### 4.2 Configurar secretos

Supabase hospedado inyecta automáticamente `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS` y `SUPABASE_SECRET_KEYS` en las Edge Functions. No los cargue con `supabase secrets set`. El backend resuelve primero esos mapas JSON (clave `default`), luego `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` para desarrollo local y finalmente `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` como compatibilidad heredada. Ninguna variable `VITE_*` se usa para secretos backend.


```bash
supabase secrets set \
  APP_URL=https://app.example.com \
  OAUTH_TOKEN_ENCRYPTION_KEY_B64=... \
  GOOGLE_CLIENT_ID=... \
  GOOGLE_CLIENT_SECRET=... \
  GOOGLE_REDIRECT_URI=... \
  GMAIL_PUBSUB_TOPIC=... \
  GMAIL_PUBSUB_AUDIENCE=https://YOUR_PROJECT.supabase.co/functions/v1/gmail-pubsub-webhook \
  GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL=... \
  WHOP_API_KEY=... \
  WHOP_WEBHOOK_SECRET=... \
  WHOP_COMPANY_ID=... \
  WHOP_WEEKLY_PLAN_ID=... \
  WHOP_ANNUAL_PLAN_ID=... \
  CRON_SECRET=...
```

Genere la clave AES con 32 bytes aleatorios:

```bash
openssl rand -base64 32
```

Genere secretos de estado OAuth con alta entropía:

```bash
openssl rand -hex 32
```

### 4.3 Desplegar funciones

```bash
supabase functions deploy whop-checkout
supabase functions deploy whop-webhook --no-verify-jwt
supabase functions deploy notification-ingest
supabase functions deploy transaction-confirm
supabase functions deploy gmail-oauth-start
supabase functions deploy gmail-oauth-callback --no-verify-jwt
supabase functions deploy gmail-sync
supabase functions deploy gmail-pubsub-webhook --no-verify-jwt
supabase functions deploy renew-mail-watches --no-verify-jwt
supabase functions deploy ai-advisor
supabase functions deploy export-data
supabase functions deploy delete-account
```

Las funciones públicas con `--no-verify-jwt` deben validar firma, estado, audiencia o secreto propio dentro del handler.

## 5. Whop

### 5.1 Crear producto y planes

- Cree un producto de acceso completo.
- Cree un plan recurrente semanal con periodo de 7 días.
- Cree un plan recurrente anual con periodo de 365 días.
- No configure plan gratuito ni prueba.
- Copie ambos `plan_id` a los secretos.

### 5.2 Webhook

Configure:

```text
https://YOUR_PROJECT.supabase.co/functions/v1/whop-webhook
```

Eventos mínimos:

- `payment.succeeded`;
- `payment.failed`;
- `membership.activated`;
- `membership.deactivated`;
- `membership.cancel_at_period_end_changed`;
- `refund.created` y `dispute.created` si afectan acceso/política.

Use API v1 y fije una fecha de versión en configuración. Pruebe en sandbox antes de production.

### 5.3 Verificaciones

- Firma válida e inválida.
- Evento duplicado.
- Activación.
- Cancelación al final del periodo.
- Pago fallido.
- Reembolso/disputa según regla comercial.
- Metadata `app_user_id` presente.

## 6. Gmail

### 6.1 Proyecto de prueba

- Cree proyecto separado de staging.
- Habilite Gmail API y Pub/Sub.
- Configure OAuth consent screen como External/Testing o Internal según el caso.
- Añada únicamente testers autorizados.
- Configure redirect URI exacta del callback.
- Solicite `openid`, `email` y el alcance Gmail mínimo que permita leer el contenido requerido.

### 6.2 Pub/Sub

- Cree tópico configurado en `GMAIL_PUBSUB_TOPIC`.
- Conceda al servicio de Gmail permiso de publicación sobre el tópico.
- Cree una cuenta de servicio para la suscripción push y habilite autenticación OIDC.
- Cree suscripción push HTTPS hacia `gmail-pubsub-webhook`.
- Configure `GMAIL_PUBSUB_AUDIENCE` con la audiencia exacta emitida en el JWT y fije obligatoriamente `GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL` con la cuenta de servicio que firma el push OIDC.
- Use `GMAIL_PUBSUB_TOKEN` en la URL únicamente con `CAPITALFLOW_ENV=local` o `test`. En cualquier entorno desplegado, la ausencia de audiencia OIDC falla cerrada.
- Ejecute `users.watch` y conserve `historyId` y `expiration`.
- Programe renovación diaria o antes de expiración.

### 6.3 Producción

Antes de abrir a usuarios generales:

- dominio verificado;
- home, privacidad y términos;
- justificación y video del flujo OAuth;
- verificación de marca y permisos;
- evaluación de seguridad aplicable si datos restringidos pasan por servidor;
- proceso de revocación y eliminación probado.

## 7. Web/PWA

### 7.1 Build

```bash
npm run build
```

El resultado se encuentra en `apps/web/dist`.

### 7.2 Hosting

Puede desplegarse en Vercel, Netlify, Cloudflare Pages, Supabase Hosting compatible o servidor estático. Requisitos:

- HTTPS;
- fallback de SPA a `index.html`;
- `manifest.webmanifest` con MIME correcto;
- `sw.js` sin cache agresivo del HTML de autenticación;
- headers de seguridad;
- variables `VITE_*` solo con valores públicos.

Ejemplo de headers:

```text
Content-Security-Policy: default-src 'self'; connect-src 'self' https://*.supabase.co; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src https://whop.com
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Ajuste CSP según checkout embebido o redirección seleccionada.

## 8. Android sin Play Store durante pruebas

### 8.1 Crear proyecto Capacitor

```bash
npm run build
npm exec -w @capitalflow/web cap add android
npm run android:install-plugin -w @capitalflow/web
npm exec -w @capitalflow/web cap sync android
npm exec -w @capitalflow/web cap open android
```

### 8.2 Manifest y plugin

El script copia:

- clases Java al paquete Android;
- snippet de servicio al `AndroidManifest.xml` si no existe;
- recursos de texto.

Revise manualmente el package name y cambie `com.capitalflow.app` por el identificador definitivo antes de firmar.

### 8.3 APK debug para equipo técnico

Desde Android Studio use Build APK o:

```bash
cd apps/web/android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### 8.4 APK release firmado

Genere un keystore y guárdelo fuera del repositorio:

```bash
keytool -genkeypair -v \
  -keystore capitalflow-release.jks \
  -alias capitalflow \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000
```

Configure signing en Gradle/Android Studio y construya:

```bash
./gradlew assembleRelease
```

Distribuya el APK firmado mediante un sitio HTTPS privado o canal controlado. Los testers deben autorizar la fuente de instalación. Conserve la misma clave para todas las actualizaciones; cambiarla impide actualizar sobre la instalación existente.

### 8.5 Pruebas obligatorias en dispositivo real

- permiso denegado/concedido/revocado;
- selección de paquetes;
- notificación normal, expandida y agrupada;
- reinicio del dispositivo;
- app cerrada y abierta;
- sin red y recuperación;
- cola mayor al límite;
- actualización APK sobre versión previa;
- diferentes locales y formatos de moneda.

## 9. Cron y mantenimiento

Jobs sugeridos:

| Frecuencia | Job |
|---|---|
| cada 5 min | procesar sync jobs pendientes |
| cada 6 h | reintentar conexiones con error transitorio |
| diario | renovar Gmail watches próximos a expirar |
| diario | `capitalflow-retention-purge-daily`: purgar candidatos rechazados y evidencia dedupe según `private.retention_policy` |
| diario | detectar membresías locales vencidas como defensa secundaria |
| semanal | reporte de salud de integraciones |

Los jobs que invocan Edge Functions usan un secreto interno y no un JWT de usuario. El purge de retención corre directamente en Postgres mediante Supabase Cron y reutiliza el mismo RPC backend; no cruza HTTP.

## 10. CI/CD

Pipeline mínimo:

```text
checkout
npm install
npm run test:all
npm run typecheck
npm run build
secret scan
SQL/RLS tests
function tests with mocks
publish preview
manual approval production
```

Para Android:

- build reproducible;
- unit tests Java;
- firma desde secret manager;
- hash SHA-256 del APK publicado;
- canal de distribución controlado.

## 11. Rollback

- Web: conservar los dos builds anteriores y activar despliegue previo.
- DB: migraciones forward-only; corrección mediante nueva migración.
- Functions: mantener tag/release por versión.
- Android: publicar APK con `versionCode` superior usando misma key.
- Parser: versionar reglas y poder desactivar una regla desde configuración.
- OAuth: poder revocar una conexión afectada sin borrar el usuario.

## 12. Checklist de producción

- [ ] RLS verificada con pruebas cruzadas.
- [ ] Whop production y webhooks firmados.
- [ ] `VITE_DEV_BYPASS_SUBSCRIPTION` ausente.
- [ ] secrets rotados después del piloto.
- [ ] OAuth production separado de testing.
- [ ] Gmail verification/assessment resuelto según alcance.
- [ ] privacidad, términos y advertencias publicados.
- [ ] exportación/eliminación probadas.
- [ ] CSP y headers revisados.
- [ ] alertas y copias de seguridad activas.
- [ ] APK firmado, hash publicado y update probado.

## 13. Importación de Excel/CSV

El frontend usa la dependencia `xlsx` únicamente para decodificar `.xlsx/.xls`; CSV/TSV/JSON se procesan con `@capitalflow/core`.

```bash
npm install
npm run test:all
npm run typecheck
npm run build
```

Pruebas mínimas antes de piloto:
- CSV colombiano con `;` y decimal `,`;
- CSV estadounidense con `,` y decimal `.`;
- XLSX con fechas y montos;
- columnas separadas Ingreso/Gasto;
- segunda importación del mismo archivo: debe devolver duplicados, no duplicar libro;
- archivo con filas inválidas: las válidas deben continuar.

## 14. Google Drive para backup anual

### 14.1 Callback único

Registrar el callback de Google Drive:

```text
https://YOUR_PROJECT.supabase.co/functions/v1/storage-oauth-callback
```

Configurar el mismo valor en:

```text
STORAGE_OAUTH_REDIRECT_URI=...
```

### 14.2 Google Drive

Habilitar Google Drive API en el proyecto OAuth y permitir el scope:

```text
openid email https://www.googleapis.com/auth/drive.appdata
```

CapitalFlow crea los backups en `appDataFolder`; no solicita acceso general a todo My Drive.

### 14.3 Funciones

Desplegar además:

```bash
supabase functions deploy storage-oauth-start
supabase functions deploy storage-oauth-callback --no-verify-jwt
supabase functions deploy storage-disconnect
supabase functions deploy storage-backup-settings
supabase functions deploy cloud-backup-create
supabase functions deploy cloud-backup-restore
supabase functions deploy cloud-backup-worker --no-verify-jwt
supabase functions deploy import-transactions
```

### 14.4 Cron de backup

Invocar `cloud-backup-worker` cada hora con `x-cron-secret`. El worker solo procesa conexiones cuya `next_backup_at` venció y vuelve a comprobar que exista un plan anual activo. La frecuencia efectiva de cada usuario puede ser manual, diaria o semanal.

### 14.5 Restore drill obligatorio

Antes de producción:
1. crear datos de prueba;
2. crear backup en Google Drive;
3. modificar/eliminar movimientos;
4. ejecutar restore;
5. comprobar que se creó `pre_restore`;
6. verificar balances, metas, inversiones y reglas;
7. comprobar que Whop y conexiones OAuth no cambiaron;
8. alterar manualmente un archivo remoto y verificar que el checksum bloquee el restore.


## 15. Onboarding y cuentas independientes

Aplicar también:

```bash
supabase db push
supabase functions deploy account-manage
```

La migración `202608130004_onboarding_multi_accounts.sql` crea `onboarding_state`, campos de cuenta, política DB de entitlement y mueve la telemetría de autonomía al esquema privado.

Checklist E2E obligatorio:

- [ ] usuario semanal crea su primera cuenta y no puede crear una segunda ni restaurar una secundaria;
- [ ] usuario anual crea principal + viaje/proyecto, ve cada cuenta de forma independiente en dashboard/libro, archiva y restaura la secundaria;
- [ ] backup anual contiene tanto la secundaria activa como archivada;
- [ ] downgrade anual→semanal archiva automáticamente secundarias; re-upgrade anual permite restaurarlas;
- [ ] OAuth Gmail vuelve al onboarding y dispara sync inicial sin botón manual;
- [ ] APK con allow-list vacía detecta localmente una notificación financiera y descarta ruido;
- [ ] aceptar una excepción crea reglas y puede resolver otras pendientes compatibles;
- [ ] dashboard y ajustes no contienen ningún porcentaje de automatización/intervención;
- [ ] `authenticated` no puede seleccionar `private.automation_metrics_30d`.

Los workers existentes de correo y backup no cambian de frecuencia. `reprocessPendingCandidates` se ejecuta síncronamente después de aprendizaje/creación de cuenta con un límite de 50 pendientes recientes para acotar carga.

## T13 release/pilot automation

Before deploying the shared CORS boundary, set hosted `APP_URL` to the real HTTPS origin of the pilot web application. Do not use localhost in hosted Edge Functions. Any Edge Function importing `_shared/http.ts` must be redeployed after changing that shared boundary.

The production PWA build generates `apps/web/public/_headers` from `apps/web/security-policy.ts`. A hosting platform must apply those headers (or equivalent nginx/CDN configuration); `npm run pilot:web` verifies the live origin, CSP, security headers, manifest and service worker cache policy.

Operations can run `npm run pilot:health` with `SUPABASE_URL` and `CRON_SECRET` in the shell. The endpoint returns only aggregate health and returns `503` when stale jobs/leases make the runtime degraded.

For Android release, keep signing material outside the repository and export `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`, then run `npm run android:release`. The helper creates, zipaligns, signs, verifies and hashes the release APK under `artifacts/`.

`npm run pilot:readiness` is the next-stage operator gate. It reuses code tests, can optionally run local pgTAP, verifies a deployed PWA and operational health when credentials/URLs are supplied, verifies a signed APK when `PILOT_APK_PATH` is supplied, and reports the remaining real-provider/legal gates explicitly instead of inventing evidence.
