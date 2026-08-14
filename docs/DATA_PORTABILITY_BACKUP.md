# Diseño — Importación y backup/restore

## Resumen

CapitalFlow incorpora dos capacidades distintas:

1. **Importación/migración**: semanal y anual. Permite comenzar con historial desde Excel, CSV, TSV, TXT o JSON.
2. **Backup/restore conectado**: anual. Guarda copias versionadas en Google Drive o OneDrive y está preparado para nuevos proveedores.

## Importación

El archivo se decodifica en el dispositivo. La app propone el mapeo, muestra preview y envía únicamente filas financieras normalizadas. Los requests usan lotes de hasta 400 filas. El backend vuelve a validar, resuelve cuenta y categoría, genera `import_key` y omite duplicados exactos.

### Campos reconocibles

- fecha;
- monto único;
- ingreso;
- gasto;
- tipo/dirección;
- comercio/contraparte;
- descripción;
- categoría;
- cuenta;
- moneda.

Se soportan fechas ISO, `dd/mm/yyyy`, fechas con hora y seriales de Excel en el núcleo. Los montos aceptan formatos `1.234.567,89` y `1,234,567.89`.

## Backup anual

El archivo `capitalflow-backup-v2` contiene únicamente estado financiero restaurable. Un checksum SHA-256 detecta modificaciones remotas. Los backups pueden ser manuales, diarios o semanales; semanal es el valor inicial.

### Google

Se usa Drive API con el scope `drive.appdata` y `appDataFolder`, evitando acceso general al Drive del usuario.

### Microsoft

Se usa Microsoft Graph con `Files.ReadWrite.AppFolder`; la app trabaja en su carpeta especial dentro de OneDrive.

## Restore

1. Verificar anual.
2. Descargar el archivo asociado al registro del usuario.
3. Calcular SHA-256 y comparar.
4. Validar `capitalflow-backup-v2`.
5. Crear un backup `pre_restore` del estado presente.
6. Ejecutar `private.restore_user_backup` dentro de PostgreSQL.
7. Invalidar cachés de frontend y recargar.

No se restauran Whop, correo, tokens ni secretos.

## Extender a otro proveedor

Un proveedor adicional debe implementar autenticación y dos primitivas: subir archivo y descargar archivo. El dominio de backup, checksum, scheduling y restore no debe depender del proveedor. Ejemplos futuros: Dropbox App Folder, WebDAV o almacenamiento S3-compatible administrado por el usuario.


## Cuentas independientes dentro del backup

Los backups anuales incluyen **todas** las filas de `accounts` del usuario, tanto activas como archivadas. Por ello conservan la cuenta principal y las cuentas temporales/de viaje/trabajo/proyecto junto con `is_primary`, `purpose`, `purpose_label`, `is_archived` y `archived_at`.

Archivar una cuenta no borra transacciones ni reglas asociadas. Esto incluye el archivo automático de secundarias cuando un usuario pasa efectivamente al plan semanal. El restore reproduce las cuentas incluidas en el documento y sus relaciones financieras; el entitlement anual se valida fuera del documento, por lo que un backup nunca concede funcionalidades de plan.
