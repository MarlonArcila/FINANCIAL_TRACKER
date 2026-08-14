# Estado de implementación — CapitalFlow MVP

**Corte:** 13 de agosto de 2026  
**Versión del scaffold:** 0.1.0

## Implementado

- Monorepo TypeScript con núcleo financiero independiente de framework.
- PWA React/Vite con autenticación Supabase, paywall sin freemium, onboarding persistente, dashboard, cuentas, libro manual, categorías, revisión excepcional de candidatos, metas, inversiones, asesor y ajustes.
- Categorías asignables a ingresos, gastos, metas e inversiones.
- Metas con aportes, progreso, faltante, prioridad, fecha y aporte mensual orientativo.
- Inversiones manuales con aportes, retiros, valoraciones históricas, valor actual y rentabilidad simple.
- Motor determinista para priorizar gastos esenciales, reserva, metas, gasto discrecional e inversión; proyecciones de interés compuesto por escenarios.
- Explicación opcional con IA sin enviar correos, notificaciones, tokens ni identificadores financieros.
- Android `NotificationListenerService`, descubrimiento local automático cuando la allowlist está vacía, filtro avanzado opcional, parser local, sanitización, cola persistente y bridge Capacitor.
- OAuth server-side para Gmail y Outlook, tokens cifrados, sincronización incremental, renovación de watches/subscriptions y webhooks rápidos que encolan trabajo.
- Whop checkout semanal/anual, webhook firmado, idempotencia y sincronización de membresía.
- PostgreSQL con cantidades en unidades menores enteras, RLS, esquema privado, vistas de lectura, auditoría, deduplicación y validación de referencias del mismo tenant.
- Exportación, desconexión de fuentes y eliminación de cuenta disponibles incluso sin membresía activa.
- Importación de historial desde CSV/TSV/TXT/XLSX/XLS/JSON para planes semanal y anual, con mapeo, preview, categorías opcionales, batches y deduplicación exacta.
- Backup/restore anual en Google Drive `appDataFolder` y OneDrive App Folder, con OAuth separado del correo, tokens cifrados, checksum SHA-256 y copia `pre_restore`.
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
- 19 pruebas server-side/políticas: automatización, calibración de onboarding, política de cuentas, backup format/checksum, Gmail/Outlook, sanitización y canonicalización de candidatas Android.
- 4 smoke tests Java sobre el parser Android, incluida la regresión que evita interpretar “Mercado” como el código de moneda `CAD`.
- Validación sintáctica TypeScript del frontend y de todas las Edge Functions.
- Workflow de GitHub Actions que instala dependencias, ejecuta `test:all`, hace typecheck estricto y construye la PWA.

## Validaciones que requieren infraestructura externa

No se ejecutaron dentro de este entorno porque dependen de credenciales o SDK externos:

- build completo Vite con dependencias descargadas;
- migración contra una instancia real de Supabase y pruebas RLS multiusuario;
- ciclos OAuth reales con Google/Microsoft para correo y almacenamiento;
- upload/download/restore reales en Google Drive y OneDrive;
- webhooks y checkout del sandbox de Whop;
- proyecto Android generado por Capacitor, pruebas JUnit/Android y APK firmado;
- entrega real de Pub/Sub de Gmail y change notifications de Microsoft Graph;
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
