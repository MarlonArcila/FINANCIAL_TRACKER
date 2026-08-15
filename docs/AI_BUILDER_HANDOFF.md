# Handoff para Codex, Lovable, Replit, Base44 y constructores similares

## 1. Prompt maestro reutilizable

Copie el siguiente bloque en la herramienta elegida y adjunte `PRD.md`, `TECHNICAL_TASKS.md`, `ARCHITECTURE.md`, la migración SQL y `packages/core`:

```text
Construye CapitalFlow siguiendo exactamente el PRD adjunto.

Reglas obligatorias:
- Usa importes enteros en unidades menores y código de moneda.
- No conectes APIs bancarias.
- Aplica automatización por excepción: una señal de alta confianza, no duplicada y resuelta sin conflicto puede contabilizarse automáticamente; crea `transaction_candidate` solo para ambigüedad, conflicto o riesgo. Las correcciones deben aprender reglas privadas y re-evaluar pendientes recientes.
- El porcentaje de automatización/intervención es telemetría interna de QA en el backend; nunca lo muestres ni lo incluyas en contratos del frontend.
- La versión web es PWA. La lectura de notificaciones requiere un APK Capacitor con NotificationListenerService Java.
- Usa Supabase Auth/PostgreSQL/RLS como referencia, salvo que la plataforma obligue a otro backend; conserva el contrato OpenAPI y las mismas entidades.
- Whop es la fuente de verdad de suscripciones semanal/anual. La API key y verificación de webhooks están solo en servidor.
- Gmail y Outlook usan OAuth; cifra refresh/access tokens y no almacenes cuerpos completos por defecto.
- El asesor sin IA debe funcionar siempre. La IA solo explica un resultado determinista y no puede cambiar cifras.
- Nunca envíes correos, notificaciones crudas, tokens, números de tarjeta ni identificadores sensibles a IA o analítica.
- Implementa pruebas, RLS, idempotencia y criterios de aceptación antes de marcar una tarea como terminada.

Trabaja en el orden de TECHNICAL_TASKS.md. Después de cada tarea:
1. enumera archivos modificados;
2. ejecuta typecheck y pruebas;
3. muestra resultados;
4. actualiza el estado de la tarea;
5. no continúes si hay un fallo de seguridad o RLS.
```

## 2. Instrucciones para Codex

- Abra el repositorio completo.
- Lea `AGENTS.md` antes de editar.
- Implemente una tarea técnica por PR/commit.
- Prefiera cambios pequeños y pruebas cercanas al módulo.
- Use mocks para proveedores externos.
- No sustituya el listener nativo por una API web ficticia.
- No hardcodee planes, keys, redirect URIs o package IDs.

Prompt por tarea:

```text
Implementa T06 del backlog. Respeta AGENTS.md. Antes de editar, inspecciona migraciones, paquetes core y contratos existentes. Al terminar ejecuta pruebas y typecheck. Incluye una tabla de trazabilidad entre criterios de aceptación y pruebas.
```

## 3. Instrucciones para Lovable

Lovable encaja especialmente bien con React/Vite/Supabase:

1. Importe o pegue la migración SQL.
2. Genere pantallas desde las historias P0.
3. Mantenga `packages/core` como funciones TypeScript compartidas.
4. Cree Edge Functions para Whop/OAuth; no llame proveedores con secretos desde el navegador.
5. Exporte el proyecto para añadir Capacitor y Java fuera del editor web.
6. Use `VITE_DEV_BYPASS_SUBSCRIPTION` solo en preview local.

Limitación: el editor web no puede implementar por sí solo el permiso Android ni `NotificationListenerService`; esa parte debe mantenerse en el repositorio exportado.

## 4. Instrucciones para Replit

Dos opciones:

- Mantener Supabase y ejecutar solo frontend/funciones auxiliares en Replit.
- Reemplazar Edge Functions por un servidor Node/Fastify que implemente el mismo OpenAPI.

Al reemplazar backend:

- PostgreSQL sigue siendo la base recomendada.
- Use middleware de sesión/JWT.
- Reproduzca RLS mediante consultas con `user_id` y pruebas de autorización, o mantenga RLS directamente en Postgres.
- Use una cola para webhooks/sync.
- Mantenga esquema privado para credenciales.

## 5. Instrucciones para Base44 u otra plataforma low-code

- Cree las entidades desde la sección Modelo de datos.
- Implemente primero manual entry, metas, inversiones y asesor determinista.
- Use webhooks server-side para Whop.
- Use acciones backend para OAuth y sync.
- Si la plataforma no permite cifrado, webhooks firmados o secretos server-only, no implemente correo/Whop allí; conecte un backend externo.
- Exporte/integre el frontend con Capacitor para Android.

## 6. Contrato visual mínimo

- Navegación inferior en móvil: Inicio, Movimientos, Metas, Inversiones, Más.
- Tarjeta superior: dinero disponible, ingresos del periodo, gastos y neto.
- Bandeja de candidatos visible con contador.
- Formularios en una sola columna en móvil.
- Importes grandes, fecha y fuente claras.
- Estados de confianza con texto, no solo color.
- Barra de meta con monto, faltante y aporte recomendado.
- Asesor con cuatro bloques: disponible, prioridades, escenarios, riesgos.
- Integraciones con estado, última sync, permiso y desconectar.

## 7. Contrato de calidad para cualquier generador

La salida no es aceptable si:

- usa `number` decimal para guardar dinero;
- permite acceso sin webhook activo;
- guarda tokens en localStorage;
- lee todas las notificaciones sin allowlist;
- envía contenido crudo a IA;
- auto-contabiliza una señal sin deduplicación, política determinista de alta confianza y resolución segura de cuenta/categoría;
- omite RLS/autorización;
- no verifica webhook;
- mezcla monedas;
- promete rentabilidad;
- presenta una PWA pura como capaz de leer notificaciones de otras apps.

## Portabilidad y backup: reglas que un AI builder no debe simplificar

- `Importar datos` pertenece a **ambos planes**. No lo conviertas en anual.
- `Cloud backup/restore` pertenece **solo al anual** y debe validarse en Edge Functions con `assertAnnualEntitled`.
- No subas ni almacenes el Excel/CSV original en Supabase; parsea localmente y envía filas normalizadas por lotes.
- No confíes en montos/fechas solo porque vienen del navegador: `import-transactions` debe revalidarlos.
- No crees cuentas automáticamente a partir de nombres desconocidos; usa una cuenta predeterminada ya creada.
- No elimines la deduplicación `import_key`.
- No uses scopes amplios de Drive/OneDrive si existen `drive.appdata` / `Files.ReadWrite.AppFolder`.
- Nunca incluyas suscripción, OAuth tokens, secretos o correo crudo en `capitalflow-backup-v2`.
- Nunca restaures antes de: checksum válido → backup `pre_restore` → confirmación `RESTAURAR`.
- Un tercer proveedor (Dropbox/WebDAV/S3-compatible) debe añadirse detrás del adaptador de almacenamiento, sin cambiar el formato financiero del backup.
