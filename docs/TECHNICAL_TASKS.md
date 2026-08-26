# Backlog técnico trazable — CapitalFlow MVP

Cada tarea indica requisitos de PRD, archivos/componentes, tablas, endpoints/funciones y definición de terminado. La secuencia recomendada es T00 → T13.

## T00 — Fundaciones del repositorio

**Requisitos:** NFR-MNT-001 a NFR-MNT-006.  
**Archivos:** `package.json`, `tsconfig.base.json`, `AGENTS.md`, `.env.example`, CI futuro.  
**Componentes:** workspaces `@capitalflow/core`, `@capitalflow/web`.  
**Tablas/endpoints:** ninguno.  
**Funciones:** scripts `build`, `test`, `typecheck`.

**Tareas concretas**

- Configurar npm workspaces y TypeScript estricto.
- Crear separación core/web/backend/native.
- Añadir lint, secret scanning y dependencia audit en CI.
- Bloquear merge si fallan pruebas o typecheck.

**Terminado cuando:** instalación limpia, build/test/typecheck reproducibles y secretos ausentes del repo.

---

## T01 — Esquema, perfiles y RLS

**Requisitos:** FR-AUTH-004, FR-LED-001, FR-CAT-001/002, NFR-SEC-005.  
**Archivos:** `supabase/migrations/202608120001_initial.sql`.  
**Tablas:** `profiles`, `accounts`, `categories`, `transactions`, `transaction_revisions`, `source_connections`, `source_events`, `transaction_candidates`, `categorization_rules`, `goals`, `goal_contributions`, `investments`, `investment_valuations`, `budget_items`, `financial_preferences`, `advisor_runs`, `subscriptions`; esquema `private`.  
**Vistas:** `account_balances`, `monthly_cashflow`, `goal_progress`, `investment_performance`.  
**Funciones:** `set_updated_at`, `handle_new_user`, `has_active_subscription`, `accept_transaction_candidate`.

**Tareas concretas**

- Crear tipos/check constraints e índices.
- Crear trigger de perfil.
- Insertar categorías del sistema.
- Activar RLS y grants mínimos.
- Implementar políticas de propiedad y suscripción.
- Crear pruebas SQL de acceso cruzado y aceptación idempotente.

**Terminado cuando:** dos usuarios de prueba no pueden leer/escribir datos ajenos y las escrituras pagas fallan sin suscripción.

---

## T02 — Autenticación y perfil web

**Requisitos:** FR-AUTH-001 a FR-AUTH-004.  
**Archivos:** `apps/web/src/hooks/useSession.ts`, `apps/web/src/App.tsx`, `apps/web/src/pages/AuthPage.tsx`, `apps/web/src/lib/supabase.ts`.  
**Tablas:** `profiles`.  
**Endpoints:** Supabase Auth.  
**Funciones:** `signUp`, `signInWithPassword`, `signOut`, `resetPassword`, `loadProfile`, `updateProfile`.

**Tareas concretas**

- Formularios accesibles de registro/login/recuperación.
- Manejar sesión, refresh y errores.
- Configurar moneda, locale y zona horaria.
- Redirigir a paywall si no hay derecho activo.

**Terminado cuando:** flujo E2E crea perfil y mantiene sesión tras recarga.

---

## T03 — Whop y paywall

**Requisitos:** FR-SUB-001 a FR-SUB-008.  
**Archivos:** `apps/web/src/components/SubscriptionGate.tsx`, `apps/web/src/pages/SubscriptionPage.tsx`, `supabase/functions/whop-checkout/index.ts`, `supabase/functions/whop-webhook/index.ts`, `_shared/whop.ts`.  
**Tablas:** `subscriptions`, `private.webhook_events`, `private.audit_events`.  
**Endpoints:** `POST whop-checkout`, `POST whop-webhook`.  
**Funciones:** `createCheckout`, `verifyWhopWebhook`, `mapMembershipStatus`, `upsertSubscription`, `assertEntitled`.

**Tareas concretas**

- Configurar IDs de planes semanal/anual en secretos.
- Aceptar solo `weekly|annual`.
- Crear checkout con `app_user_id` metadata e idempotency key.
- Verificar webhook con SDK/Standard Webhooks.
- Deduplicar y procesar eventos fuera del camino crítico.
- Bloquear funciones y escrituras sin membresía válida.

**Terminado cuando:** sandbox activa/desactiva acceso, replay no duplica y ninguna key aparece en cliente.

---

## T04 — Libro manual y categorías

**Requisitos:** FR-LED-001 a FR-LED-008, FR-CAT-001 a FR-CAT-005.  
**Archivos:** `TransactionsPage.tsx`, `TransactionForm.tsx`, `CategoriesPage.tsx` o modal, `apps/web/src/lib/data.ts`, `packages/core/src/money.ts`.  
**Tablas:** `accounts`, `categories`, `transactions`, `transaction_revisions`, `categorization_rules`.  
**Endpoints:** Data API bajo RLS.  
**Funciones:** `toMinorUnits`, `formatMinor`, `createTransaction`, `updateTransaction`, `voidTransaction`, `createCategory`, `suggestCategory`.

**Tareas concretas**

- CRUD de cuentas y categorías.
- Formulario ingreso/gasto/transferencia.
- Filtros y paginación.
- Revisión y auditoría de edición/anulación.
- Exportación CSV/JSON inicial.

**Terminado cuando:** saldos/vistas cuadran y no existen errores por punto flotante.

---

## T05 — Librería de parsing y deduplicación

**Requisitos:** FR-AND-005, FR-MAIL-007/008, FR-CAN-001/006, NFR-MNT-004.  
**Archivos:** `packages/core/src/parser/*`, `packages/core/src/dedupe.ts`, `packages/core/test/parser.test.ts`.  
**Tablas:** ninguna directa.  
**Endpoints:** consumida por ingesta/sync.  
**Funciones:** `parseLocalizedMoney`, `classifyDirection`, `extractMerchant`, `sanitizeFinancialText`, `parseFinancialEvent`, `createFingerprint`, `isLikelyDuplicate`.

**Tareas concretas**

- Soportar COP/USD/EUR y separadores ES/EN.
- Definir keywords y patrones versionados.
- Rechazar OTP, saldos promocionales y mensajes sin evidencia.
- Calcular confianza y razones.
- Crear fixtures anonimizados.

**Terminado cuando:** pruebas objetivo de precisión pasan y cambios de reglas son versionados.

---

## T06 — Bandeja de candidatos

**Requisitos:** FR-CAN-001 a FR-CAN-008.  
**Archivos:** `CandidateReview.tsx`, `DashboardPage.tsx`, `supabase/functions/notification-ingest/index.ts`, `supabase/functions/transaction-confirm/index.ts`.  
**Tablas:** `source_events`, `transaction_candidates`, `transactions`, `categorization_rules`.  
**Endpoints:** `POST notification-ingest`, `POST transaction-confirm`.  
**Funciones:** `ingestCandidateBatch`, `dedupeCandidate`, `acceptCandidate`, `rejectCandidate`, `createRuleFromCorrection`.

**Tareas concretas**

- Insertar evento + candidata con upsert.
- Aplicar la política determinista después de deduplicar: contabilizar solo señales de alta confianza con cuenta/categoría resueltas sin conflicto; crear o mantener `pending` únicamente para excepciones.
- Mostrar razones/confianza.
- Editar campos y aceptar por RPC atómica.
- Registrar corrección y regla opcional.
- Reprocesar excepciones recientes después de aprender una regla o crear una cuenta.
- Mantener telemetría de automatización solo en el backend/esquema privado; no exponer porcentajes al cliente.

**Terminado cuando:** una señal inequívoca se contabiliza una sola vez; aceptar dos veces la misma excepción crea exactamente una transacción; rechazar no cambia saldos.

---

## T07 — Android nativo y distribución de prueba

**Requisitos:** FR-AND-001 a FR-AND-009.  
**Archivos:** `native/android/src/main/java/com/capitalflow/notification/FinanceNotificationListenerService.java`, `NotificationAccessPlugin.java`, `NotificationCandidateParser.java`, `NotificationQueue.java`, `native/android/AndroidManifest.service.xml`, `apps/web/scripts/install-android-plugin.mjs`, `apps/web/src/lib/notificationAccess.ts`, `apps/web/src/pages/IntegrationsPage.tsx`.  
**Tablas:** `source_connections` opcional para preferencias; backend en T06.  
**Endpoints:** `notification-ingest`.  
**Funciones:** `isPermissionGranted`, `openPermissionSettings`, `setAllowedPackages`, `peekCandidates`, `ackCandidates`, `onNotificationPosted`.

**Tareas concretas**

- Generar proyecto Capacitor Android.
- Copiar plugin mediante script.
- Implementar allowlist y cola limitada.
- Sanitizar antes de persistencia local.
- Simular avisos en pruebas Java.
- Construir y firmar APK.
- Probar instalación ADB y directa.

**Terminado cuando:** una notificación permitida llega como señal sanitizada y se auto-contabiliza o queda como excepción según la política; paquete no permitido/OTP no aparece y reinicio no pierde cola.

---

## T08 — Metas de ahorro

**Requisitos:** FR-GOA-001 a FR-GOA-005.  
**Archivos:** `GoalsPage.tsx`, `GoalCard.tsx`, `packages/core/src/advisor/compound.ts`.  
**Tablas:** `goals`, `goal_contributions`; vista `goal_progress`.  
**Endpoints:** Data API y RPC opcional `add_goal_contribution`.  
**Funciones:** `requiredPeriodicContribution`, `createGoal`, `addContribution`, `completeGoal`.

**Tareas concretas**

- CRUD de metas.
- Selección de categoría `goal` o `mixed`.
- Aporte manual/vinculado.
- Barra, faltante y periodos.
- Validar idempotencia por transacción.

**Terminado cuando:** progreso coincide con suma de aportes y fecha produce aporte requerido correcto.

---

## T09 — Inversiones manuales

**Requisitos:** FR-INV-001 a FR-INV-006.  
**Archivos:** `apps/web/src/pages/InvestmentsPage.tsx`, `apps/web/src/lib/data.ts`, `packages/core/src/advisor/compound.ts`, `packages/core/src/advisor/risk.ts`.  
**Tablas:** `investments`, `investment_transactions`, `investment_valuations`; vista `investment_performance`.  
**Endpoints:** Data API.  
**Funciones:** `calculateInvestmentReturn`, `futureValue`, `futureValueWithContributions`, `recordValuation`.

**Tareas concretas**

- CRUD y valoración histórica.
- Categoría `investment` o `mixed`, aportes y retiros manuales.
- Retorno absoluto/porcentual.
- Proyección y supuestos.
- Estados de riesgo y advertencias.

**Terminado cuando:** capital cero no produce infinito y valoración conserva historial.

---

## T10 — Asesor determinista e IA opcional

**Requisitos:** FR-ADV-001 a FR-ADV-011.  
**Archivos:** `packages/core/src/advisor/deterministic.ts`, `compound.ts`, `risk.ts`, `apps/web/src/pages/AdvisorPage.tsx`, `supabase/functions/ai-advisor/index.ts`.  
**Tablas:** `financial_preferences`, `budget_items`, `advisor_runs`.  
**Endpoints:** `POST ai-advisor`; CRUD de preferencias.  
**Funciones:** `buildAllocationPlan`, `assessReturnFeasibility`, `buildRiskScenarios`, `explainWithoutAI`, `requestAIExplanation`, `validateAIOutput`.

**Tareas concretas**

- Motor puro y versionado.
- Escenarios y advertencias.
- UI para ajustar entradas.
- Gateway IA con payload minimizado.
- Validar que cifras no cambien.
- Fallback completo sin IA.

**Terminado cuando:** misma entrada produce misma salida y caída del proveedor IA no bloquea el plan.

---

## T11 — Gmail

**Requisitos:** FR-MAIL-001, FR-MAIL-003 a FR-MAIL-009.  
**Archivos:** `gmail-oauth-start`, `gmail-oauth-callback`, `gmail-sync`, `gmail-pubsub-webhook`, `_shared/oauth.ts`, `_shared/crypto.ts`, `_shared/gmail.ts`, `IntegrationsPage.tsx`.  
**Tablas:** `source_connections`, `private.oauth_credentials`, `source_events`, `transaction_candidates`, `private.sync_jobs`.  
**Endpoints:** las cuatro funciones Gmail y cron de renovación.  
**Funciones:** `signOAuthState`, `exchangeGoogleCode`, `refreshGoogleToken`, `registerGmailWatch`, `syncGmailConnection`, `decodeMimeText`, `disconnectGmail`.

**Tareas concretas**

- Crear proyecto OAuth de prueba.
- Solicitar scope mínimo viable.
- Cifrar credenciales.
- Sync inicial limitado e incremental.
- Pub/Sub y renovación.
- Desconexión/revocación.
- Preparar documentación de verificación de producción.

**Terminado cuando:** un correo de fixture se procesa una sola vez y, según la política, se auto-contabiliza o crea una excepción; la desconexión elimina tokens.

---

## T12 — Proveedor alternativo de correo (retirado)

**Estado:** `SUPERSEDED / NOT_APPLICABLE`. El contrato vigente usa Gmail como único proveedor de correo. No crear endpoints, secretos, callbacks ni código para un segundo proveedor durante el piloto.

---

## T13 — PWA, privacidad, hardening y piloto

**Requisitos:** FR-PWA-001 a FR-PWA-005, FR-AUTH-005, NFR completos.  
**Archivos:** `manifest.webmanifest`, `sw.js`, `registerServiceWorker.ts`, `export-data`, `delete-account`, `docs/DEPLOYMENT.md`, CI.  
**Tablas:** `private.audit_events`, jobs de purga.  
**Endpoints:** `export-data`, `delete-account`, `renew-mail-watches`, `purge-expired-data`.  
**Funciones:** `registerServiceWorker`, `exportUserData`, `deleteUserAccount`, `purgeRejectedCandidates`, health checks.

**Tareas concretas**

- Cache versionado y estado offline.
- Exportación y eliminación.
- Rate limit, CORS, headers y CSP.
- Accesibilidad y E2E.
- Dashboard técnico y alertas.
- APK release firmado, PWA staging y plan de rollback.

**Terminado cuando:** criterios de salida del PRD pasan y existe checklist firmado de piloto.

---

# Matriz requisito → tarea

| Grupo de requisitos | Tarea principal | Archivos clave | Datos/API clave |
|---|---|---|---|
| FR-AUTH-001..004 | T02 | AuthPage, useSession, supabase.ts | Auth + profiles |
| FR-AUTH-005 | T13 | export/delete functions | export-data, delete-account |
| FR-SUB-001..008 | T03 | SubscriptionGate, Whop functions | subscriptions, webhook events |
| FR-LED-001..008 | T04 | TransactionsPage, data.ts | accounts, transactions, views |
| FR-CAT-001..005 | T04/T05 | category UI, classifier | categories, rules |
| FR-AND-001..009 | T07 | Java listener/plugin | notification-ingest |
| FR-MAIL-001/003..009 | T11 | Gmail functions | OAuth creds, watch, candidates |
| FR-MAIL-002 | T12 | Retirado del contrato | N/A |
| FR-CAN-001..008 | T05/T06 | parser, CandidateReview | source_events, candidates, RPC |
| FR-GOA-001..005 | T08 | GoalsPage, compound | goals, contributions, view |
| FR-INV-001..006 | T09 | InvestmentsPage, compound/risk | investments, valuations |
| FR-ADV-001..011 | T10 | deterministic advisor, AI function | preferences, budget, runs |
| FR-PWA-001..005 | T13 | manifest, sw, app shell | cache/offline/export |
| NFR-SEC/PRI | T01/T03/T11/T13 | RLS, crypto, webhooks, CI | private schema, audit |
| NFR-PER/REL | T11/T13 | incremental sync, jobs, metrics | cursors, retries, health |
| NFR-ACC/MNT | T00/T02/T13 | design system, tests, docs | CI/OpenAPI |

# Archivos que deben existir al finalizar

```text
apps/web/src/
  App.tsx
  components/{SubscriptionGate,AppShell,TransactionForm,CandidateReview,GoalCard}.tsx
  pages/{AuthPage,DashboardPage,TransactionsPage,GoalsPage,InvestmentsPage,AdvisorPage,IntegrationsPage,SubscriptionPage,SettingsPage}.tsx
  hooks/{useSession,useHashRoute,useAndroidCandidateSync,useConnectivityStatus}.ts
  lib/{supabase,data,api,cache,notificationAccess}.ts
packages/core/src/
  domain.ts
  money.ts
  dedupe.ts
  advisor/{compound,deterministic,risk}.ts
supabase/functions/
  _shared/{http,supabase,auth,crypto,oauth,ingestion}.ts
  whop-checkout/index.ts
  whop-webhook/index.ts
  notification-ingest/index.ts
  transaction-confirm/index.ts
  gmail-oauth-start/index.ts
  gmail-oauth-callback/index.ts
  gmail-sync/index.ts
  gmail-pubsub-webhook/index.ts
  renew-mail-watches/index.ts
  ai-advisor/index.ts
  export-data/index.ts
  delete-account/index.ts
native/android/src/main/java/com/capitalflow/notification/
  FinanceNotificationListenerService.java
  NotificationAccessPlugin.java
  NotificationCandidateParser.java
  NotificationQueue.java
```

## T14 — Importación desde otros trackers (semanal + anual)

**Objetivo:** migrar historial sin captura manual.

**Archivos/componentes**
- `packages/core/src/importing/index.ts`: CSV/TSV, JSON, detección de columnas, montos y fechas.
- `apps/web/src/lib/fileImport.ts`: lectura de CSV/Excel/JSON y SHA-256 local.
- `apps/web/src/pages/DataTransferPage.tsx`: upload, mapeo, preview, resumen e historial.
- `supabase/functions/import-transactions/index.ts`: validación, lotes, resolución de cuenta/categoría y deduplicación.
- `supabase/migrations/202608130003_imports_cloud_backup.sql`: `data_imports`, `transactions.import_batch_id`, `transactions.import_key`, source `import_file`.
- `packages/core/test/importing.test.mjs`: formatos y normalización.

**Criterios técnicos**
- Backend exige cualquier plan activo con `assertEntitled`.
- Máximo 400 filas por request y 15 MB por archivo en cliente.
- No guardar bytes crudos del archivo.
- Reimportación exacta idempotente mediante `import_key`.
- Crear categorías importadas opcionalmente; no crear cuentas implícitamente.

## T15 — Cloud backup/restore (solo anual)

**Objetivo:** respaldo privado, automático y restaurable en almacenamiento del propio usuario.

**Tablas**
- `storage_connections`
- `private.storage_oauth_credentials`
- `private.storage_oauth_states`
- `cloud_backups`

**Edge Functions**
- `storage-oauth-start`
- `storage-oauth-callback`
- `storage-disconnect`
- `storage-backup-settings`
- `cloud-backup-create`
- `cloud-backup-restore`
- `cloud-backup-worker`

**Shared**
- `_shared/storage-oauth.ts`
- `_shared/cloud-storage.ts`
- `_shared/cloud-backup-service.ts`
- `_shared/backup.ts`
- `_shared/backup-format.ts`

**Criterios técnicos**
- `assertAnnualEntitled` en todas las acciones iniciadas por usuario.
- OAuth de almacenamiento separado del correo.
- Google `drive.appdata`/`appDataFolder` como único proveedor de backup del contrato vigente.
- Tokens cifrados con la misma capa AES-GCM del backend.
- Backup JSON versionado, checksum SHA-256, sin secretos.
- Frecuencia manual/diaria/semanal; semanal por defecto.
- Worker autenticado por `x-cron-secret`.
- Restore con confirmación, checksum y backup automático previo.
- Restore financiero transaccional y sin suscripción/tokens.


## T16 — Onboarding autónomo

**Objetivo:** completar configuración una sola vez y pasar a operación por excepción.

**Archivos/componentes**
- `apps/web/src/components/OnboardingGate.tsx`: bloquea AppShell hasta completar onboarding.
- `apps/web/src/pages/OnboardingPage.tsx`: monedas, principal, correo, Android y 3–5 asociaciones.
- `apps/web/src/lib/data.ts`: `loadOnboardingState`, `updateOnboardingState`, `completeOnboarding`.
- `supabase/migrations/202608130004_onboarding_multi_accounts.sql`: `onboarding_state` + RLS.
- `gmail-oauth-callback/index.ts`: encolar sync inicial.
- `native/android/.../FinanceNotificationListenerService.java`: allow-list vacía = descubrimiento automático local.
- `_shared/automation.ts`: `reprocessPendingCandidates`.
- `transaction-confirm/index.ts`: aprender y re-procesar.

**Criterios técnicos**
- Persistir progreso server-side.
- Una conexión Gmail activa.
- Android nativo exige permiso; PWA lo trata como no aplicable.
- Intentar 3–5 asociaciones, sin bloqueo eterno si no hay señales.
- No exponer porcentaje de autonomía al frontend.

## T17 — Cuentas independientes por plan

**Objetivo:** permitir seguimiento temporal separado sin romper el libro principal.

**Datos**
- `accounts.is_primary`
- `accounts.purpose`
- `accounts.purpose_label`
- `accounts.archived_at`

**Backend**
- `supabase/functions/account-manage/index.ts`: `create`, `archive`, `restore`.
- `supabase/functions/_shared/account-policy.ts`: política pura semanal/anual.
- `supabase/functions/_shared/account-policy.test.ts`: pruebas de entitlement.
- `private.enforce_account_plan()`: defensa a nivel DB.

**Frontend**
- `SettingsPage.tsx`: lista activa/archivada, creación anual, archive/restore.
- `DashboardPage.tsx`: selector `todas / cuenta concreta` y resumen independiente.
- `TransactionsPage.tsx`: filtro del ledger por cuenta, incluidas archivadas.
- `SubscriptionPage.tsx`: empaquetado visible por plan.
- `data.ts`: `listAllAccounts`, `createAccount`, `setAccountArchived`, `listTransactions(limit, accountId)`, `loadDashboardSummary(accountId)`.

**Criterios técnicos**
- Primera cuenta = principal/general.
- Semanal rechaza segunda activa incluso por API directa.
- Anual permite propósitos `trip/work/shared/project/other`.
- Principal nunca se archiva.
- Archive no borra ledger.
- Backup/restore conserva activas y archivadas.
- Crear una cuenta reevalúa candidatos pendientes recientes.
- Downgrade efectivo a semanal archiva secundarias de forma no destructiva; anual activo tiene precedencia.

## T18 — Telemetría interna de autonomía

**Objetivo:** guiar ingeniería sin convertir el porcentaje en una función visible.

- La migración mueve `public.automation_metrics_30d` a `private.automation_metrics_30d`.
- `authenticated` y `anon` no tienen acceso; solo `service_role`.
- Eliminar campos `automationRatePercent`/`interventionRatePercent` de `DashboardSummary`.
- Eliminar tarjetas, textos y controles numéricos de umbral del frontend.
- Mantener los umbrales técnicos en `financial_preferences`/backend para evolución del sistema.
