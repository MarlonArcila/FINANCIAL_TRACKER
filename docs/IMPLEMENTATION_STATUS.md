# Estado de implementación — CapitalFlow MVP

**Corte:** 26 de agosto de 2026
**Versión del scaffold:** 0.1.0

> Criterio documental vigente: la ingestión opera por excepción. Las señales inequívocas pueden auto-contabilizarse; `transaction_candidates` queda reservada para ambigüedad, conflicto o riesgo. Las reglas aprendidas reevalúan pendientes y la telemetría de automatización es exclusivamente interna.

> Contrato de proveedores vigente: correo **Gmail** y backup anual **Google Drive `appDataFolder`**. El release de la frontera privada Data API quedó en `main` `e251ae9b85bc5517246f0aaced70b2a4a6db24c6`, con migración, RPC/ACL, despliegue transitivo de Edge Functions y smoke remoto GREEN.

## Auditoría de seguridad de Edge Functions — 15 de agosto de 2026

- Se revisaron las 28 funciones y `supabase/config.toml`: las 19 funciones A conservan el JWT de Gateway; los callbacks OAuth (B), webhooks verificados (C) y workers internos (D) usan `verify_jwt = false` de forma intencional y validan su límite de confianza dentro del handler.
- Se corrigió el consumo de `storage_oauth_states`: el `UPDATE` atómico ahora exige también que el estado siga vigente, evitando una carrera que consumía un state vencido.
- Gmail Pub/Sub en modo OIDC exige ahora el correo de la service account configurada y `email_verified`; el fallback por token queda limitado a instalaciones sin audiencia OIDC.
- `cloud-backup-worker` reutiliza la validación constante de `CRON_SECRET` de los demás workers.
- Los errores, logs y respuestas de proveedores ya no incluyen cuerpos remotos, payloads ni mensajes arbitrarios; se conservan sólo categorías y códigos seguros.
- Cobertura nueva: estados OAuth de almacenamiento caducados/usados/malformados, identidad OIDC no confiable, secreto CRON inválido y respuesta de error sin filtración. Las pruebas E2E que aún requieren infraestructura externa se limitan a los gates no cerrados de Google Drive, Whop, RLS multiusuario, Android firmado y PWA staging.

## Implementado

- Monorepo TypeScript con núcleo financiero independiente de framework.
- PWA React/Vite con autenticación Supabase, paywall sin freemium, onboarding persistente, dashboard, cuentas, libro manual, categorías, revisión excepcional de candidatos, metas, inversiones, asesor y ajustes.
- Categorías asignables a ingresos, gastos, metas e inversiones.
- Metas con aportes, progreso, faltante, prioridad, fecha y aporte mensual orientativo.
- Inversiones manuales con aportes, retiros, valoraciones históricas, valor actual y rentabilidad simple.
- Motor determinista para priorizar gastos esenciales, reserva, metas, gasto discrecional e inversión; proyecciones de interés compuesto por escenarios.
- Explicación opcional con IA sin enviar correos, notificaciones, tokens ni identificadores financieros.
- Android `NotificationListenerService`, descubrimiento local automático cuando la allowlist está vacía, filtro avanzado opcional, parser local, sanitización, cola persistente y bridge Capacitor.
- OAuth server-side para Gmail, tokens cifrados, sincronización incremental, renovación de watches y Pub/Sub; el flujo real de Gmail ya fue validado en el entorno de candidato.
- Whop checkout semanal/anual, webhook firmado, idempotencia y sincronización de membresía.
- PostgreSQL con cantidades en unidades menores enteras, RLS, esquema privado, vistas de lectura, auditoría, deduplicación y validación de referencias del mismo tenant.
- Exportación, desconexión de fuentes y eliminación de cuenta disponibles incluso sin membresía activa.
- Importación de historial desde CSV/TSV/TXT/XLSX/XLS/JSON para planes semanal y anual, con mapeo, preview, categorías opcionales, batches y deduplicación exacta.
- Backup/restore anual en Google Drive `appDataFolder`, con OAuth separado del correo, tokens cifrados, checksum SHA-256 y copia `pre_restore`; el E2E OAuth/upload/download/restore real de Drive sigue pendiente.
- Backup automático anual configurable como diario, semanal o manual; semanal por defecto.
- Plan semanal limitado a una cuenta principal activa; plan anual con cuentas secundarias independientes para viaje, trabajo, proyectos, compartidas u otros seguimientos.
- Dashboard con ámbito por cuenta y libro filtrable para analizar esos seguimientos sin mezclarlos con la principal.
- Downgrade a semanal archiva automáticamente las secundarias sin destruir su historial; un anual activo tiene precedencia.
- Archivo/restauración no destructiva de cuentas secundarias y conservación dentro de backups anuales.
- Aprendizaje retroactivo: aceptar una excepción o crear una cuenta reevalúa pendientes recientes para evitar preguntas repetidas.
- Telemetría de autonomía movida al esquema privado; no se muestran porcentajes de automatización/intervención al usuario.
- Caché local de lectura para modo sin conexión; el entitlement nunca se toma del caché.
- OpenAPI, PRD, arquitectura, backlog técnico, despliegue y handoff para otros constructores con IA.

## Evidencia de verificación incluida

- 18 pruebas del núcleo: parsing financiero, importación CSV/TSV/JSON, montos/fechas, ruido/OTP, deduplicación, asignación, déficit, interés compuesto y rentabilidad.
- pruebas server-side/políticas para automatización, OAuth, backups y límites de autenticación: automatización, calibración de onboarding, política de cuentas, backup format/checksum, Gmail, sanitización y canonicalización de candidatas Android.
- 4 smoke tests Java sobre el parser Android, incluida la regresión que evita interpretar “Mercado” como el código de moneda `CAD`.
- Validación sintáctica TypeScript del frontend y de todas las Edge Functions.
- Workflow de GitHub Actions que instala dependencias, ejecuta `test:all`, hace typecheck estricto y construye la PWA.

## Validaciones que requieren infraestructura externa

No se ejecutaron dentro de este entorno porque dependen de credenciales o SDK externos:

- build completo Vite con dependencias descargadas;
- migración contra una instancia real de Supabase y pruebas RLS multiusuario;
- ciclo OAuth real de Google Drive para almacenamiento;
- upload/download/restore reales en Google Drive;
- webhooks y checkout del sandbox de Whop;
- proyecto Android generado por Capacitor, pruebas JUnit/Android y APK firmado;
- revalidación de entrega Pub/Sub de Gmail solo si cambia su configuración o código;
- prueba E2E en un teléfono con notificaciones de aplicaciones permitidas.

El workflow de CI cubre la instalación, typecheck y build web. `docs/DEPLOYMENT.md` contiene el procedimiento para completar las validaciones con los servicios y secretos del propietario.

## Limitaciones deliberadas del MVP

- No se conecta a bancos, brokers ni plataformas de pago mediante sus APIs.
- Las detecciones de alta confianza pueden auto-contabilizarse; las ambiguas permanecen revisables y las dudosas se silencian según política configurable.
- La precisión depende del texto que cada emisor incluya en la notificación o correo.
- El parser inicial trabaja con reglas y español/inglés; debe ampliarse con muestras reales anonimizadas.
- La inversión usa valores ingresados por el usuario y rentabilidad simple; no calcula TIR ni precios de mercado.
- Las clases de inversión son educativas, no recomendaciones de productos ni garantías.
- La PWA por sí sola no lee notificaciones de otras aplicaciones; esa capacidad existe únicamente en el APK Android.

## Próximo gate recomendado

Configurar un entorno sandbox completo, ejecutar el checklist de `docs/DEPLOYMENT.md`, probar con dos usuarios para verificar aislamiento RLS y realizar un piloto cerrado con APK firmado y fuentes de correo de prueba antes de procesar datos financieros reales.

### T13 implementation closure

Code-level T13 hardening includes fail-closed CORS, production CSP/security headers, a bounded/versioned PWA cache, operational health RPC/Edge endpoint, two-tenant RLS regression coverage, pilot PWA verification, signed-APK automation, and a consolidated pilot-readiness runner. Rate limiting, retention purge, export/delete and the private Data API gateway were released in prior T13 checkpoints.

The code implementation can be closed independently from external pilot evidence. Real Google Drive OAuth/backup/restore, Whop sandbox purchase/webhook, two-real-user RLS confirmation, signed APK on a physical device, deployed PWA/domain headers, and legal/privacy review remain external gates and must not be marked GREEN from repository evidence alone.
