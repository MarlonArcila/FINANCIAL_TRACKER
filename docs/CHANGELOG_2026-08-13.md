# Cambios — 13 de agosto de 2026

## Producto

- El plan semanal conserva la automatización completa; el plan anual desbloquea IA.
- La interfaz de suscripción enfatiza el anual como experiencia recomendada.
- El asesor con IA exige entitlement anual también en backend.

## Automatización

- Auto-contabilización para candidatos de alta confianza.
- Auto-descarte de detecciones bajo el piso configurado.
- Cola manual solo para ambigüedades y casos limítrofes.
- Aprendizaje de cuenta por paquete/remitente y de categoría por comercio.
- Preselección de valores ya resueltos cuando una excepción llega a revisión.
- Telemetría privada de autonomía de 30 días para QA; eliminada de toda interfaz de usuario.
- Precarga del asesor desde cuentas, movimientos y preferencias para reducir digitación repetitiva.

## Multi-moneda

- Moneda base y monedas habilitadas por perfil.
- Selector de moneda en cuentas, metas, inversiones y asesor.
- Conversor interno.
- Consolidación del dashboard por moneda antes de convertir a la moneda base.
- Servicio `fx-rate` con caché, fuente, timestamp y advertencia obligatoria.
- Adaptador de piloto a la cotización pública visible de Google Finance y proveedor alternativo configurable.

## Backend y datos

- Nueva migración `202608130002_automation_multicurrency_plans.sql`.
- Nuevas tablas/columnas de reglas de asignación, FX y trazabilidad de auto-post.
- Nuevo endpoint `fx-rate`.
- Nuevo helper `assertAnnualEntitled`.

## Verificación local

- 13 pruebas del núcleo: pasan.
- 9 pruebas server-side/parser/política de automatización: pasan.
- 4 smoke tests Android: pasan.
- 81 archivos TypeScript/TSX analizados sintácticamente: sin errores de parseo.
- `OPENAPI.yaml`: YAML válido.
- El typecheck/build completo del frontend no pudo ejecutarse porque la descarga de dependencias Vite/React no finalizó dentro del límite de red del entorno. Debe ejecutarse en CI o en una máquina con `npm install` completo.

## Portabilidad de datos e importación

- Nueva pantalla `Datos` para importar históricos de otras plataformas.
- Importación disponible tanto en plan semanal como anual.
- Soporte de entrada para CSV, TSV, TXT delimitado, JSON, XLSX y XLS.
- Detección de delimitador, encabezados en español/inglés, montos localizados y fechas seriales de Excel.
- Mapeo previo de columnas, vista previa y selección de cuenta predeterminada.
- Importación por lotes con validación server-side y creación opcional de categorías.
- Clave `import_key` y hash de archivo para evitar duplicados en reimportaciones.
- El archivo fuente no se persiste en el servidor después de normalizarlo.

## Backup y restore anual

- Backup/restore en nube restringido al plan anual y validado en backend.
- Implementaciones concretas para Google Drive y OneDrive.
- Google Drive usa el espacio privado `appDataFolder`; OneDrive usa el App Folder de la aplicación.
- Tokens OAuth almacenados cifrados y separados de las conexiones de correo.
- Formato versionado `capitalflow-backup-v2` con checksum SHA-256.
- Restore transaccional que crea primero un backup `pre_restore` de seguridad.
- Frecuencia configurable `manual`, `daily` o `weekly`; semanal es el valor predeterminado.
- Worker programable para ejecutar backups automáticos solo cuando el entitlement anual continúa activo.
- El backup excluye tokens OAuth, Whop, secretos, contenido crudo de correo/notificaciones y texto generado por IA.

## Verificación posterior

- 18 pruebas del núcleo: pasan.
- 12 pruebas server-side: pasan.
- 4 smoke tests Android: pasan.
- 113 archivos TypeScript/TSX analizados sintácticamente: sin errores de parseo.
- JSON del repositorio: válido.
- `OPENAPI.yaml`: YAML válido.
- El typecheck/build web completo sigue pendiente de una instalación completa de dependencias web en un entorno con acceso npm estable; el intento de instalación en este entorno agotó el límite de red.


## Onboarding autónomo y cuentas independientes

- Nuevo `OnboardingGate` persistente después del paywall.
- Configuración única de monedas, cuenta principal, Gmail/Outlook, permiso Android y calibración de 3–5 ejemplos cuando estén disponibles.
- Gmail y Outlook encolan una primera sincronización automáticamente al terminar OAuth.
- Android usa descubrimiento financiero local cuando la allow-list está vacía; la lista manual queda como opción avanzada.
- Aceptar una excepción aprende reglas y reevalúa automáticamente pendientes recientes compatibles.
- Crear una cuenta nueva también reevalúa pendientes para aprovechar asociaciones ya conocidas.
- Eliminados del dashboard y ajustes todos los porcentajes de automatización/intervención; la telemetría pasó a `private.automation_metrics_30d`, visible solo para `service_role`.
- Plan semanal: una única cuenta principal activa.
- Plan anual: cuenta principal más cuentas independientes de viaje, trabajo, proyecto, compartidas u otras.
- Las cuentas secundarias anuales pueden archivarse/restaurarse sin perder historial.
- Los backups incluyen cuentas activas y archivadas con propósito y metadatos de archivo.
- Nueva migración `202608130004_onboarding_multi_accounts.sql`, endpoint `account-manage`, helpers `account-policy.ts` y `onboarding-policy.ts`, `OnboardingPage` y `OnboardingGate`.
- Las primeras 3–5 señales útiles se reservan como calibración antes de liberar el flujo autónomo; el contador se actualiza en backend para evitar carreras.
- Dashboard con selector de ámbito por cuenta y libro con filtro por cuenta, incluidas archivadas.
- Downgrade efectivo a semanal archiva secundarias automáticamente y conserva su historial; una membresía anual activa prevalece si coexisten memberships.


## Verificación de onboarding/cuentas

- 18 pruebas del núcleo: pasan.
- 19 pruebas server-side/políticas: pasan, incluidas 4 de calibración y 3 de cuentas.
- 4 smoke tests Android: pasan.
- 105 archivos TS/TSX analizados sintácticamente: sin errores.
- `OPENAPI.yaml` validado como YAML.
- El typecheck completo del workspace sigue bloqueado únicamente por la dependencia `vite/client` no instalada en este entorno; CI debe ejecutar `npm install && npm run typecheck && npm run build`.
