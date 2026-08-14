# Onboarding, cuentas independientes y autonomía — CapitalFlow

**Corte:** 13 de agosto de 2026

## 1. Onboarding de configuración única

Después de autenticación y suscripción, `OnboardingGate` mantiene al usuario en una configuración persistente hasta cubrir:

1. moneda base y monedas habilitadas;
2. cuenta principal;
3. al menos Gmail u Outlook;
4. permiso de notificaciones cuando se ejecuta el APK Android;
5. calibración inicial de 3–5 señales financieras cuando existen ejemplos disponibles.

El progreso se almacena en `onboarding_state`, por lo que una redirección OAuth, recarga o reinicio no obliga a comenzar de nuevo.

### PWA → APK

Completar el onboarding en la PWA no falsifica el permiso Android. Si posteriormente el usuario abre el APK y nunca concedió acceso a notificaciones, el gate reabre únicamente esa necesidad. Cuando el permiso se concede queda registrado como completado. Revocarlo posteriormente no destruye la configuración: la integración puede administrarse desde Fuentes.

## 2. Calibración protegida

Durante el onboarding, las primeras señales útiles que normalmente podrían auto-contabilizarse se reservan como ejemplos hasta cubrir el objetivo de calibración. Solo se reservan los slots necesarios; el resto del flujo puede seguir la política normal.

```text
señal financiera útil
        ↓
parser + dedupe + resolución
        ↓
¿faltan ejemplos de calibración?
  sí → excepción pre-resuelta para confirmar
  no → política autónoma normal
```

La confirmación se contabiliza server-side antes de re-procesar pendientes, evitando carreras del frontend. Una confirmación puede aprender fuente→cuenta y comercio→categoría. Después se ejecuta `reprocessPendingCandidates()` para aplicar ese aprendizaje a señales similares.

Si no existen suficientes eventos recientes, una búsqueda de calibración sin más pendientes permite finalizar para no bloquear indefinidamente al usuario.

## 3. Android sin package names obligatorios

Una allow-list vacía activa descubrimiento local. `NotificationListenerService` observa las notificaciones autorizadas por Android, el parser descarta ruido/OTP/promociones localmente y solo las señales financieras sanitizadas entran a la cola de CapitalFlow.

La lista explícita de paquetes permanece como filtro avanzado opcional.

## 4. Gmail y Outlook

Al terminar OAuth, cada callback encola automáticamente una primera sincronización. El usuario no necesita volver y pulsar un botón técnico para iniciar el backfill. Después continúan los mecanismos incrementales existentes.

## 5. Cuentas por plan

### Semanal

- una única cuenta principal activa;
- importación, automatización, Gmail/Outlook, Android, metas, inversiones y multi-moneda continúan disponibles;
- no puede crear ni restaurar una segunda cuenta activa.

### Anual

- cuenta principal;
- cuentas independientes `trip`, `work`, `shared`, `project` u `other`;
- etiqueta opcional, por ejemplo “Viaje a México con amigos”;
- archive/restore no destructivo;
- IA y cloud backup/restore según las reglas ya definidas.

La política se aplica tanto en `account-manage` como en `private.enforce_account_plan()`.

## 6. Ámbito independiente

Crear una cuenta de viaje no debe mezclar sus métricas con la principal. Por eso:

- Dashboard: selector `Todas las cuentas activas` o una cuenta concreta.
- Con cuenta concreta: ingresos, gastos y flujo neto se calculan solo con sus movimientos y se presentan en su moneda.
- Libro: filtro por cuenta, incluidas cuentas archivadas, para consultar el historial posteriormente.

## 7. Downgrade anual → semanal

Si después de procesar un evento Whop el entitlement efectivo queda solo en semanal, CapitalFlow archiva automáticamente las cuentas secundarias activas. No elimina movimientos, reglas ni metadatos.

Si coexiste una membresía anual activa/no vencida, el entitlement anual tiene precedencia y no se archivan secundarias.

Volver al anual habilita el restore de las cuentas archivadas.

## 8. Backup

`capitalflow-backup-v2` ya incluye `accounts` mediante `select(*)`, por lo que conserva:

- principal y secundarias;
- activas y archivadas;
- `is_primary`;
- `purpose`;
- `purpose_label`;
- `is_archived`;
- `archived_at`;
- movimientos y reglas relacionadas incluidas en sus respectivas colecciones.

El backup nunca restaura entitlement Whop.

## 9. Autonomía como criterio interno

El objetivo de intervención mínima guía parser, reglas, re-procesamiento, deduplicación y UX, pero no es una función visible. Se eliminó cualquier porcentaje de automatización/intervención del frontend.

`private.automation_metrics_30d` existe únicamente para QA con `service_role`. El cliente autenticado no tiene permiso de lectura.

## 10. Archivos principales

- `apps/web/src/components/OnboardingGate.tsx`
- `apps/web/src/pages/OnboardingPage.tsx`
- `apps/web/src/pages/DashboardPage.tsx`
- `apps/web/src/pages/TransactionsPage.tsx`
- `apps/web/src/pages/SettingsPage.tsx`
- `apps/web/src/lib/data.ts`
- `supabase/migrations/202608130004_onboarding_multi_accounts.sql`
- `supabase/functions/account-manage/index.ts`
- `supabase/functions/_shared/account-policy.ts`
- `supabase/functions/_shared/onboarding-policy.ts`
- `supabase/functions/_shared/automation.ts`
- `supabase/functions/transaction-confirm/index.ts`
- `supabase/functions/whop-webhook/index.ts`
- `supabase/functions/gmail-oauth-callback/index.ts`
- `supabase/functions/outlook-oauth-callback/index.ts`
- `native/android/src/main/java/com/capitalflow/notification/FinanceNotificationListenerService.java`

## 11. Verificación local de esta iteración

- Core: 18/18 pruebas.
- Server-side/políticas: 19/19 pruebas.
- Android parser smoke: 4/4.
- TS/TSX: 105 archivos analizados sintácticamente, 0 errores.
- OpenAPI: YAML válido.
- Escaneo del frontend: sin campos/tarjetas/textos de porcentaje de automatización/intervención.

El typecheck/build web completo requiere instalar las dependencias del workspace. En este entorno `vite/client` no está disponible; CI debe ejecutar `npm install`, `npm run typecheck` y `npm run build`.
