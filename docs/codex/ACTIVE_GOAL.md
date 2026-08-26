# Active Goal

## GOAL_ID

`PASO-8A-WORKER-HARDENING-GATE`

## TITLE

Llevar el hardening de workers del Paso 8A a un gate local reproducible y confiable.

## SOURCE_REQUIREMENT

Hardening de workers, leases, backup runs, seguridad de RPC y concurrencia del Paso 8A; requisitos explícitos del encargo y `AGENTS.md`.

## PRD_REFERENCE

`docs/PRD.md`: ingestión de correo, automatización por excepción, privacidad, backups y operación segura.

## TECHNICAL_TASK_REFERENCE

`docs/TECHNICAL_TASKS.md`: workers de sincronización/renovación/backup y validaciones locales; `docs/DEPLOYMENT.md`: separación local/remoto.

## OBJECTIVE

Demostrar localmente, cuando esté disponible la infraestructura desechable, claims atómicos, leases, finalización con token, recuperación conservadora, entitlement anual para backups, seguridad de RPC y concurrencia de un único ganador.

## IN_SCOPE

- Revisar y corregir migración `202608150005_worker_leases_and_backup_runs.sql`.
- Revisar workers y helpers relacionados.
- Reconstruir `watch_leases.test.sql` si corresponde.
- Corregir el harness pgTAP sin conceder privilegios de inspección al `service_role` sólo por comodidad.
- Mantener y verificar `scripts/test-local-worker-concurrency.mjs` con localhost únicamente.
- Ejecutar validaciones locales seguras y documentar el gate.

## OUT_OF_SCOPE

- Supabase remoto, `--linked`, `db push`, deploy, Cron remoto, proveedores reales, producción y Git remoto.
- Docker en esta ejecución inicial.
- Marcar Paso 8A como completado sin pruebas aplicables.

## FILES_EXPECTED

- `supabase/migrations/202608150005_worker_leases_and_backup_runs.sql`
- `supabase/tests/database/backup_runs.test.sql`
- `supabase/tests/database/worker_leases.test.sql`
- `supabase/tests/database/worker_security.test.sql`
- `supabase/tests/database/watch_leases.test.sql`
- `scripts/test-local-worker-concurrency.mjs`
- Workers y helpers listados por `git status`.

## INVARIANTS

- `private` permanece privado y cada tabla expuesta conserva RLS.
- Sólo `service_role` ejecuta las RPC internas requeridas.
- Un lease activo no se roba; uno expirado se recupera según la política.
- Un token incorrecto no finaliza ni libera; un token correcto sólo finaliza una vez.
- Backup sólo para entitlement anual válido; un fallo no avanza `next_backup_at`.
- Sin credenciales, contenido crudo ni valores monetarios inseguros.

## SECURITY_BOUNDARIES

- No leer `.env.local`, `.env`, historiales ni archivos de credenciales.
- No mostrar tokens ni valores sensibles.
- No conceder `SELECT` general a `service_role` para arreglar tests.
- Separar role under test de test harness al inspeccionar `private.*`.

## ACCEPTANCE_CRITERIA

- El harness pgTAP tiene planes correctos, fixtures válidos y cobertura de mail, watches, backup y seguridad.
- Existe y pasa un test de leases de watches.
- La concurrencia local produce exactamente un ganador o queda documentada como bloqueada por infraestructura.
- Las validaciones locales reproducibles pasan sin tocar remoto.
- La documentación distingue `IMPLEMENTED` de `TESTED_LOCAL` y el gate no se marca completado prematuramente.

## VALIDATION_COMMANDS

- `npm run typecheck`
- `npm run test:all`
- `npm run build`
- `git diff --check`
- `npx supabase --network-id capitalflow-local test db` sólo después de confirmar Supabase local desechable disponible.
- `node scripts/test-local-worker-concurrency.mjs` sólo contra localhost.

## REGRESSION_TESTS

- Tests unitarios de funciones afectadas.
- Tests pgTAP de workers/RPC/RLS.
- Script de concurrencia local.

## HUMAN_GATES

- Cualquier secreto, proveedor externo, Supabase remoto, deploy, producción, Cron remoto, Git remoto u operación irreversible.
- Decisiones sobre cambiar contratos de seguridad o alcance.

## ROLLBACK_STRATEGY

Revertir únicamente cambios nuevos del goal mediante parches explícitos y reversibles; nunca resetear, limpiar, restaurar o guardar en stash el worktree existente.

## STATUS

`IMPLEMENTED — STATIC_VALIDATION_PASS — WAITING_FOR_OPERATOR_CONCURRENCY_RERUN`

## DISCOVER_NOTES

La migración y los workers de Paso 8A existen como cambios sin commit. La inspección confirmó tests pgTAP defectuosos: `backup_runs.test.sql` inspecciona `private.backup_runs` bajo el rol equivocado; `worker_leases.test.sql` contiene una lista `VALUES` inconsistente; `worker_security.test.sql` declara plan 23 pero ejecuta 24; `watch_leases.test.sql` no está presente y debe reconstruirse. La documentación no prueba por sí sola el gate local.

## IMPLEMENTATION_NOTES

Esta iteración corrige exclusivamente el harness pgTAP: reconstruye `watch_leases.test.sql`, hace explícito `started_at = NULL` en fixtures legacy, corrige los planes y separa `SET LOCAL ROLE service_role` de la inspección del harness. La migración 150005 se revisó y no se modifica porque los defectos conocidos son de tests.

## TEST_RESULTS

PgTAP real no se ejecutó por instrucción. Auditoría estática: worker leases 15/15, watch leases 12/12, backup runs 25/25, security 51/51; cada archivo tiene exactamente un BEGIN, plan(N), finish() y ROLLBACK. `npm run typecheck` PASS; `npm run test:all` PASS (18 core, 38 edge, 4 Android); `npm run build` PASS; `git diff --check` PASS. El script de concurrencia sigue presente. Estado: `IMPLEMENTED`, `STATIC_VALIDATION_PASS`, `WAITING_FOR_OPERATOR_PGTAP`.

## OPEN_RISKS

- Infraestructura Supabase local y ejecución pgTAP dependen del operador.
- La cobertura de concurrencia queda fuera de esta iteración.
- La migración no se valida contra una base local en este entorno.

## PGTAP-HARNESS-REPAIR-2

El operador ejecutó pgTAP real: `worker_security.test.sql` pasó; backup, watches y worker abortaron por defectos de harness. Se confirmó `HARNESS_DEFECT`: `inactive` no pertenece a `subscriptions_status_check`; watches inspeccionaba `private.mail_watch_renewal_leases` mientras `service_role` seguía activo; y los fixtures de jobs violaban `sync_jobs_connection_active_uidx`. Se corrigieron los tres harnesses sin modificar la migración, debilitar privilegios ni relajar el índice.

La auditoría posterior quedó en worker leases 17/17, watch leases 12/12, backup runs 25/25 y security 51/51; cada archivo tiene exactamente un BEGIN, plan(N), finish() y ROLLBACK. El worker plan cambió legítimamente de 15 a 17 para conservar assertions separadas de finalización y limpieza tras corregir el role switching.

## PGTAP-HARNESS-REPAIR-3

Evidencia del operador: WORKER_SECURITY_PGTAP=PASS, WATCH_PGTAP=11/12, WORKER_LEASE_PGTAP=15/17, BACKUP_PGTAP=ABORT_AFTER_16; por tanto GLOBAL_PGTAP=FAIL.

Causas corregidas: el ultimo watch claim se aislo revocando explicitamente todas las conexiones fixture; el no-steal worker se aislo dejando solo el job protegido elegible y el job independiente se inserta despues; el claim independiente se valida en un universo aislado; y el scheduler state de backup se captura/compara desde public.storage_connections, que contiene next_backup_at y last_backup_at. La migracion 150005 permanece sin cambios.

Auditoria local posterior: worker leases 17/17, watch leases 12/12, backup runs 25/25, security 51/51; cada archivo tiene exactamente un BEGIN, plan(N), finish() y ROLLBACK; no hay accesos private.* bajo service_role. npm run typecheck, npm run test:all, npm run build y git diff --check pasaron.

## PGTAP-HARNESS-REPAIR-4

Evidencia del operador: BACKUP_RUNS_PGTAP=PASS, WATCH_LEASES_PGTAP=PASS, WORKER_SECURITY_PGTAP=PASS, WORKER_LEASES_PGTAP=FAIL_AT_ASSERTION_12_AND_UUID_CAST; GLOBAL_PGTAP=FAIL.

Causa raíz confirmada: el job independiente 00000000-0000-4000-8000-000000000285 no estaba insertado cuando se ejecutaba su claim; el test reclamaba globalmente con p_connection_id=NULL y luego intentaba leer su token ausente mediante current_setting, que devolvía cadena vacía y fallaba al convertirla a UUID.

Corrección: el job independiente se inserta después de finalizar el job anterior, se valida que existe y está queued, se reclama usando su connection_id específico, y se inspeccionan su estado y lease mediante su UUID determinista. Los claims active, expired e histórico también usan p_connection_id específico. No se modificaron los otros tests ni la migración.

Auditoría local: 21 assertions/plan(21), exactamente un BEGIN, finish() y ROLLBACK; no hay private.* bajo service_role ni casts de UUID desde valores vacíos. npm run typecheck, npm run test:all, npm run build y git diff --check pasaron.

## CONCURRENCY

SUBGOAL=CONCURRENCY

Operator evidence: DB_RESET=PASS, PGTAP=PASS, PGTAP_FILES=4, PGTAP_TESTS=109.

The local concurrency gate is prepared but was not executed by Codex. It uses two independent local PostgreSQL client processes for mail, watch, and backup claims, validates known resource identities, rejects non-local database hosts, sanitizes output, and cleans fixtures best-effort in finally blocks.

Manual versus worker exclusion is covered by a local static boundary check and deterministic mock race using the shared claim mechanism. Google Drive `appDataFolder` reconciliation is covered by local fetch-mock tests; no second cloud-storage provider belongs to the current pilot contract.

Status: WAITING_FOR_OPERATOR_CONCURRENCY.

## CONCURRENCY-REPAIR-2

Evidencia real del operador: PSQL_INSTALLED=PASS, LOCAL_PSQL_CONNECTIVITY=PASS, DB_RESET=PASS, PGTAP=PASS, PGTAP_FILES=4, PGTAP_TESTS=109. Segunda ejecución: MAIL=PASS, WATCH=FAIL, BACKUP=FAIL, MANUAL_VS_WORKER=PASS, CONCURRENCY_RESULT=FAIL.

Causa del harness: WATCH y BACKUP no tenían preconditions ni diagnóstico sanitizado; ambos claims globales podían devolver cero o una fila de otro recurso, y el runner no verificaba de forma explícita la identidad y el logical run. La semántica real confirma que WATCH se ordena globalmente y BACKUP deriva scheduled_for desde storage_connections.next_backup_at.

Corrección local: se añadieron preconditions de elegibilidad, counts A/B/total, códigos y etapas sanitizados, evaluadores puros de identidad, verificación de un único backup_run por storage_connection + scheduled_for y tests Node para los casos cero/uno/dos claims. No se modificaron MAIL, MANUAL_VS_WORKER, pgTAP ni la migración.

Validación local: node --check, tests puros 4/4 y git diff --check PASS. No se ejecutó el runner contra PostgreSQL.

Estado: WAITING_FOR_OPERATOR_CONCURRENCY_RERUN.

## CONCURRENCY-FIXTURE-REPAIR-1

Evidencia real del operador: THIRD_CONCURRENCY_RUN con MAIL=PASS, WATCH=FAIL_AT_FIXTURE_SETUP y WATCH_FAILURE_CODE=psql_nonzero; BACKUP=FAIL_AT_FIXTURE_SETUP y BACKUP_FAILURE_CODE=psql_nonzero; MANUAL_VS_WORKER=PASS; CONCURRENCY_RESULT=FAIL.

La comparación columna a columna confirmó que la fixture WATCH coincide con source_connections y con watch_leases.test.sql. La fixture BACKUP usa columnas existentes y valores válidos; se hizo explícito provider=whop para coincidir con el contrato de subscriptions. No hubo ejecución de carrera ni evidencia de defecto de migración.

El clasificador psql ahora conserva sólo stdout machine-readable, captura stderr internamente, clasifica SQLSTATE y patrones en categorías sanitizadas, y cubre constraint, foreign key, unique, not null, undefined column/function, permission, syntax, connection y psql_not_found. Se añadieron 5 tests Node puros.

Preconditions, aislamiento por suffix, cleanup best-effort, MAIL y MANUAL_VS_WORKER se preservan. Estado: WAITING_FOR_OPERATOR_CONCURRENCY_RERUN.

## CONCURRENCY-CONSTRAINT-DIAGNOSIS-1

Evidencia real del operador: FOURTH_CONCURRENCY_RUN con MAIL=PASS; WATCH=FAIL en fixture_setup con constraint_violation; BACKUP=FAIL en fixture_setup con constraint_violation; MANUAL_VS_WORKER=PASS; CONCURRENCY_RESULT=FAIL. No hubo carrera ejecutada ni evidencia de defecto de RPC/migración.

Auditoría estática: source_connections cumple provider/status, FK y unique user/provider; subscriptions cumple provider=whop, interval/status, FK y unique nullable membership; storage_connections cumple provider/status/frequency, FK y unique user/provider. Las fixtures tienen namespaces distintos por prefijo, emails distintos y cleanup por escenario. No se encontró violación estática ni colisión cross-fixture.

El runner ahora ejecuta psql con VERBOSITY=verbose internamente, extrae SQLSTATE y nombres de constraint sólo si cumplen ^[A-Za-z0-9_.-]{1,128} y nunca imprime stderr, SQL, URL, tokens o stacks. Tests puros del clasificador: 5/5 PASS.

Estado: WAITING_FOR_OPERATOR_CONCURRENCY_RERUN.

## CONCURRENCY-FIXTURE-IDENTITY-REPAIR-1

Evidencia real del operador: FIFTH_CONCURRENCY_RUN con MAIL=PASS; WATCH=FAIL_AT_FIXTURE_SETUP, unique_violation, SQLSTATE=23505, constraint=users_pkey; BACKUP=FAIL_AT_FIXTURE_SETUP, unique_violation, SQLSTATE=23505, constraint=users_pkey; MANUAL_VS_WORKER=PASS; CONCURRENCY_RESULT=FAIL.

Causa exacta: MAIL, WATCH y BACKUP construian userId con el mismo prefijo UUID y el mismo suffix temporal global. WATCH y BACKUP intentaban insertar el auth.users.id creado por MAIL.

Correccion: factory makeFixtureIds basada en randomUUID() para MAIL, WATCH, BACKUP y MANUAL, con userId, email, connectionId, jobId, subscriptionId y storageConnectionId independientes. Se elimino la fuente timestamp/concatenacion fragil. Se agrego cleanup preventivo y final limitado a IDs exactos, con errores de cleanup reportados por separado.

Tests puros: 7/7 PASS para UUIDs, unicidad entre escenarios, emails example.invalid, factories consecutivas, cleanup exacto y ausencia de ON CONFLICT masking. No se modificaron pgTAP, migracion, RPCs, MAIL o MANUAL_VS_WORKER semanticamente.

Estado: WAITING_FOR_OPERATOR_CONCURRENCY_RERUN.

## SIXTH_CONCURRENCY_RUN

MAIL_CONCURRENCY=PASS
MAIL_CLEANUP=FAIL_PERMISSION_DENIED_42501
WATCH_TOTAL_CLAIMS=1
WATCH_TARGET_IDENTITY=FAIL
WATCH_CLEANUP=FAIL_PERMISSION_DENIED_42501
BACKUP_CONCURRENCY=PASS
BACKUP_LOGICAL_RUN_COUNT=1
BACKUP_CLEANUP=FAIL_PERMISSION_DENIED_42501
MANUAL_VS_WORKER=PASS
CONCURRENCY_RESULT=FAIL

Estado actual: WAITING_FOR_CLEAN_DB_CONCURRENCY_RERUN.

## FINAL_DECISION

`HUMAN_GATE_REQUIRED` para ejecutar el gate de concurrencia local; Paso 8A completo continúa sin cerrarse.
