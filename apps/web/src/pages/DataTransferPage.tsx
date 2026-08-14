import { useEffect, useMemo, useState } from "react";
import { normalizeImportRows, type ImportField, type ImportMapping, type NormalizedImportRow } from "@capitalflow/core";

import { Notice } from "../components/Notice";
import { invokeFunction } from "../lib/api";
import { clearFinancialCache } from "../lib/cache";
import { demoMode } from "../lib/env";
import { importTransactionRows, listAccounts, listCloudBackups, listDataImports, listStorageConnections, loadProfile, loadSubscription } from "../lib/data";
import { readImportFile, type ParsedImportFile } from "../lib/fileImport";
import type { Account, AppUser, CloudBackup, DataImportRecord, StorageConnection, Subscription } from "../lib/types";

const fields: Array<{ key: ImportField; label: string; optional?: boolean }> = [
  { key: "date", label: "Fecha" },
  { key: "amount", label: "Monto único", optional: true },
  { key: "income", label: "Columna de ingresos", optional: true },
  { key: "expense", label: "Columna de gastos", optional: true },
  { key: "kind", label: "Tipo ingreso/gasto", optional: true },
  { key: "merchant", label: "Comercio / contraparte", optional: true },
  { key: "description", label: "Descripción", optional: true },
  { key: "category", label: "Categoría", optional: true },
  { key: "account", label: "Cuenta", optional: true },
  { key: "currency", label: "Moneda", optional: true },
];

export function DataTransferPage({ user }: { user: AppUser }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [imports, setImports] = useState<DataImportRecord[]>([]);
  const [storage, setStorage] = useState<StorageConnection[]>([]);
  const [backups, setBackups] = useState<CloudBackup[]>([]);
  const [parsed, setParsed] = useState<ParsedImportFile | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [defaultAccountId, setDefaultAccountId] = useState("");
  const [defaultKind, setDefaultKind] = useState<"income" | "expense">("expense");
  const [sourceApp, setSourceApp] = useState("");
  const [createCategories, setCreateCategories] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewErrors, setPreviewErrors] = useState<Array<{ sourceRow: number; message: string }>>([]);

  const annual = Boolean(subscription && subscription.interval === "annual" && ["active", "trialing"].includes(subscription.status) && (!subscription.current_period_end || Date.parse(subscription.current_period_end) > Date.now()));
  const defaultAccount = accounts.find((account) => account.id === defaultAccountId) ?? accounts[0] ?? null;
  const normalized = useMemo(() => {
    if (!parsed || !defaultAccount) return { rows: [] as NormalizedImportRow[], errors: [] as Array<{ sourceRow: number; message: string }> };
    try {
      return normalizeImportRows(parsed.rows, mapping, { defaultCurrency: defaultAccount.currency, defaultKind, dayFirst: true });
    } catch (caught) {
      return { rows: [] as NormalizedImportRow[], errors: [{ sourceRow: 0, message: caught instanceof Error ? caught.message : "No fue posible preparar el archivo." }] };
    }
  }, [parsed, mapping, defaultAccount, defaultKind]);

  async function refresh(): Promise<void> {
    try {
      const [nextAccounts, nextSubscription, nextImports, nextStorage, nextBackups, profile] = await Promise.all([
        listAccounts(), loadSubscription(user.id), listDataImports(), listStorageConnections(), listCloudBackups(), loadProfile(user.id),
      ]);
      setAccounts(nextAccounts);
      setSubscription(nextSubscription);
      setImports(nextImports);
      setStorage(nextStorage);
      setBackups(nextBackups);
      setDefaultAccountId((current) => current || nextAccounts.find((account) => account.currency === profile.base_currency)?.id || nextAccounts[0]?.id || "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible cargar la gestión de datos.");
    }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => { setPreviewErrors(normalized.errors.slice(0, 20)); }, [normalized.errors]);

  async function selectFile(file: File | null): Promise<void> {
    if (!file) return;
    setBusy("file"); setError(null); setMessage(null);
    try {
      const next = await readImportFile(file);
      setParsed(next);
      setMapping(next.mapping);
      setMessage(`Archivo leído: ${next.rows.length.toLocaleString("es-CO")} filas${next.sheetName ? ` · hoja ${next.sheetName}` : ""}. Revisa el mapeo antes de importar.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible leer el archivo."); }
    finally { setBusy(null); }
  }

  function updateMapping(field: ImportField, header: string): void {
    setMapping((current) => ({ ...current, [field]: header || undefined }));
  }

  async function runImport(): Promise<void> {
    if (!parsed || !defaultAccount) return;
    if (!mapping.date) { setError("Selecciona la columna de fecha."); return; }
    if (!mapping.amount && !mapping.income && !mapping.expense) { setError("Selecciona un monto único o columnas de ingreso/gasto."); return; }
    if (!normalized.rows.length) { setError("No hay filas válidas para importar."); return; }
    setBusy("import"); setError(null); setMessage(null);
    try {
      let importId: string | undefined;
      let result: Awaited<ReturnType<typeof importTransactionRows>> | null = null;
      const chunkSize = 300;
      for (let offset = 0; offset < normalized.rows.length; offset += chunkSize) {
        const chunk = normalized.rows.slice(offset, offset + chunkSize);
        const commonInput = {
          sourceApp: sourceApp.trim() || null,
          defaultAccountId: defaultAccount.id,
          createMissingCategories: createCategories,
          rows: chunk,
          finalChunk: offset + chunkSize >= normalized.rows.length,
        };
        result = await importTransactionRows(importId
          ? { ...commonInput, importId }
          : {
              ...commonInput,
              filename: parsed.filename,
              fileType: parsed.fileType,
              fileSha256: parsed.sha256,
              mapping: Object.fromEntries(
                Object.entries(mapping).filter(([, value]) => Boolean(value)),
              ) as Record<string, string>,
            });
        importId = result.importId;
      }
      clearFinancialCache();
      setMessage(`Importación completada: ${result?.cumulative.rows_imported ?? 0} movimientos nuevos, ${result?.cumulative.rows_duplicate ?? 0} duplicados omitidos y ${result?.cumulative.rows_rejected ?? 0} rechazados.`);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible importar los movimientos."); }
    finally { setBusy(null); }
  }

  async function connectStorage(provider: "google_drive" | "onedrive"): Promise<void> {
    if (!annual) { window.location.hash = "/subscription"; return; }
    setBusy(`connect-${provider}`); setError(null);
    try {
      if (demoMode) { setMessage(`${provider} conectado en modo demo.`); return; }
      const result = await invokeFunction<{ authorizationUrl: string }>("storage-oauth-start", { provider, returnUrl: `${window.location.origin}/#/data` });
      window.location.assign(result.authorizationUrl);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible iniciar la conexión."); }
    finally { setBusy(null); }
  }


  async function updateBackupFrequency(connectionId: string, frequency: "manual" | "daily" | "weekly"): Promise<void> {
    if (!annual) return;
    setBusy(`frequency-${connectionId}`); setError(null);
    try {
      if (!demoMode) await invokeFunction("storage-backup-settings", { connectionId, frequency });
      setMessage(`Backup automático actualizado: ${frequency === "manual" ? "solo manual" : frequency === "daily" ? "diario" : "semanal"}.`);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible guardar la frecuencia."); }
    finally { setBusy(null); }
  }

  async function disconnectStorage(connectionId: string): Promise<void> {
    if (!window.confirm("Desconectar este almacenamiento de CapitalFlow? Los archivos de backup ya creados permanecerán en tu nube.")) return;
    setBusy(`disconnect-${connectionId}`); setError(null);
    try {
      if (!demoMode) await invokeFunction("storage-disconnect", { connectionId });
      setMessage("Almacenamiento desconectado. Tus archivos remotos no fueron borrados.");
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible desconectar el almacenamiento."); }
    finally { setBusy(null); }
  }

  async function createBackup(connectionId: string): Promise<void> {
    setBusy(`backup-${connectionId}`); setError(null); setMessage(null);
    try {
      if (demoMode) { setMessage("Backup simulado creado."); return; }
      const result = await invokeFunction<{ filename: string; bytes: number }>("cloud-backup-create", { connectionId, kind: "manual" });
      setMessage(`Backup creado: ${result.filename} (${formatBytes(result.bytes)}).`);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible crear el backup."); }
    finally { setBusy(null); }
  }

  async function restoreBackup(backup: CloudBackup): Promise<void> {
    const phrase = window.prompt(`Restaurar ${backup.remote_file_name} reemplazará tus datos financieros actuales. Escribe RESTAURAR para continuar.`);
    if (phrase !== "RESTAURAR") return;
    const connection = storage.find((item) => item.provider === backup.provider && item.status === "active");
    if (!connection) { setError("Conecta nuevamente el proveedor donde está el backup."); return; }
    setBusy(`restore-${backup.id}`); setError(null); setMessage(null);
    try {
      if (demoMode) { setMessage("Restore simulado completado."); return; }
      const result = await invokeFunction<{ restored: boolean; safetyBackupName: string }>("cloud-backup-restore", { connectionId: connection.id, backupId: backup.id, confirmation: phrase });
      clearFinancialCache();
      setMessage(`Restore completado. Antes de restaurar se creó automáticamente ${result.safetyBackupName}.`);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible restaurar el backup."); }
    finally { setBusy(null); }
  }

  return (
    <section className="page">
      <div className="page-heading"><div><span className="eyebrow">PORTABILIDAD Y RESPALDO</span><h1>Importar, respaldar y restaurar</h1><p>Migra tu historial desde otros trackers y conserva copias privadas en tu propia nube.</p></div></div>
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <article className="panel stack">
        <div><span className="eyebrow">SEMANAL + ANUAL</span><h2>Importar desde otra plataforma</h2><p>Admite CSV, TSV, TXT, Excel XLSX/XLS y JSON. CapitalFlow intenta reconocer las columnas automáticamente y omite duplicados exactos.</p></div>
        <label className="field"><span>Archivo</span><input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.json" disabled={busy !== null} onChange={(event) => void selectFile(event.target.files?.[0] ?? null)} /></label>
        {accounts.length === 0 ? <Notice tone="warning">Crea al menos una cuenta antes de importar movimientos.</Notice> : null}
        {parsed && defaultAccount ? <>
          <div className="form-grid">
            <label className="field"><span>Cuenta predeterminada</span><select value={defaultAccountId} onChange={(event) => setDefaultAccountId(event.target.value)}>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {account.currency}</option>)}</select><small>Si el archivo trae una cuenta que coincide exactamente con una cuenta existente, se usará esa; si no, se usará esta.</small></label>
            <label className="field"><span>Plataforma de origen (opcional)</span><input value={sourceApp} onChange={(event) => setSourceApp(event.target.value)} placeholder="Wallet, Fintonic, hoja propia…" /></label>
            <label className="field"><span>Si el archivo no indica tipo y el monto es positivo</span><select value={defaultKind} onChange={(event) => setDefaultKind(event.target.value as "income" | "expense")}><option value="expense">Tratar como gasto</option><option value="income">Tratar como ingreso</option></select></label>
            <label className="checkbox-field"><input type="checkbox" checked={createCategories} onChange={(event) => setCreateCategories(event.target.checked)} /><span>Crear automáticamente categorías importadas que aún no existan</span></label>
          </div>
          <div className="mapping-grid">
            {fields.map((field) => <label className="field" key={field.key}><span>{field.label}{field.optional ? " (opcional)" : ""}</span><select value={mapping[field.key] ?? ""} onChange={(event) => updateMapping(field.key, event.target.value)}><option value="">— No usar —</option>{parsed.headers.map((header) => <option value={header} key={header}>{header}</option>)}</select></label>)}
          </div>
          <div className="import-summary"><strong>{normalized.rows.length.toLocaleString("es-CO")} filas listas</strong><span>{normalized.errors.length.toLocaleString("es-CO")} con errores</span></div>
          {previewErrors.length ? <Notice tone="warning">Ejemplos a revisar: {previewErrors.slice(0, 5).map((item) => `fila ${item.sourceRow}: ${item.message}`).join(" · ")}</Notice> : null}
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Monto</th><th>Moneda</th><th>Comercio</th><th>Categoría</th></tr></thead><tbody>{normalized.rows.slice(0, 8).map((row) => <tr key={row.source_row}><td>{new Date(row.occurred_at).toLocaleDateString("es-CO")}</td><td>{row.kind === "income" ? "Ingreso" : "Gasto"}</td><td>{(row.amount_minor / 100).toLocaleString("es-CO")}</td><td>{row.currency}</td><td>{row.merchant ?? "—"}</td><td>{row.category_name ?? "—"}</td></tr>)}</tbody></table></div>
          <button className="primary-button" type="button" disabled={busy !== null || !normalized.rows.length} onClick={() => void runImport()}>{busy === "import" ? "Importando…" : `Importar ${normalized.rows.length.toLocaleString("es-CO")} movimientos`}</button>
        </> : null}
      </article>

      <article className="panel stack data-section-gap">
        <div><span className="eyebrow">SOLO PLAN ANUAL</span><h2>Backups y restores en tu nube</h2><p>La copia se guarda en la carpeta privada de la aplicación de Google Drive o OneDrive usando permisos mínimos. No se incluyen tokens OAuth, credenciales ni el estado de tu suscripción.</p></div>
        {!annual ? <Notice tone="info">Esta función requiere el plan anual. La importación de archivos de arriba sigue disponible en el plan semanal.</Notice> : null}
        <div className="integration-grid">
          {(["google_drive", "onedrive"] as const).map((provider) => {
            const connection = storage.find((item) => item.provider === provider);
            return <article className="integration-card" key={provider}><div className="integration-icon">{provider === "google_drive" ? "G" : "O"}</div><h2>{provider === "google_drive" ? "Google Drive" : "OneDrive"}</h2>{connection ? <p><strong>{connection.account_label ?? "Cuenta vinculada"}</strong><br /><small>Estado {connection.status}{connection.last_backup_at ? ` · último backup ${new Date(connection.last_backup_at).toLocaleString("es-CO")}` : ""}</small></p> : <p>Conecta tu almacenamiento para crear y recuperar backups.</p>}{connection?.status === "active" ? <label className="field"><span>Backup automático</span><select value={connection.backup_frequency} disabled={!annual || busy !== null} onChange={(event) => void updateBackupFrequency(connection.id, event.target.value as "manual" | "daily" | "weekly")}><option value="weekly">Semanal</option><option value="daily">Diario</option><option value="manual">Solo manual</option></select><small>{connection.next_backup_at ? `Próxima copia: ${new Date(connection.next_backup_at).toLocaleString("es-CO")}` : "Sin copia automática programada."}</small></label> : null}<div className="button-row"><button className="secondary-button" type="button" disabled={!annual || busy !== null} onClick={() => void connectStorage(provider)}>{connection ? "Reconectar" : "Conectar"}</button>{connection?.status === "active" ? <button className="primary-button" type="button" disabled={!annual || busy !== null} onClick={() => void createBackup(connection.id)}>Crear backup ahora</button> : null}{connection ? <button className="text-button" type="button" disabled={!annual || busy !== null} onClick={() => void disconnectStorage(connection.id)}>Desconectar</button> : null}</div></article>;
          })}
        </div>
        {annual && backups.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Backup</th><th>Proveedor</th><th>Fecha</th><th>Tamaño</th><th></th></tr></thead><tbody>{backups.map((backup) => <tr key={backup.id}><td>{backup.remote_file_name}<br /><small>{backup.kind === "pre_restore" ? "Copia automática previa a restore" : "Copia normal"}</small></td><td>{backup.provider === "google_drive" ? "Google Drive" : "OneDrive"}</td><td>{new Date(backup.created_at).toLocaleString("es-CO")}</td><td>{formatBytes(backup.bytes)}</td><td><button className="secondary-button" type="button" disabled={busy !== null} onClick={() => void restoreBackup(backup)}>Restaurar</button></td></tr>)}</tbody></table></div> : null}
      </article>

      {imports.length ? <article className="panel data-section-gap"><h2>Importaciones recientes</h2><div className="table-scroll"><table className="data-table"><thead><tr><th>Archivo</th><th>Fecha</th><th>Nuevos</th><th>Duplicados</th><th>Rechazados</th></tr></thead><tbody>{imports.map((item) => <tr key={item.id}><td>{item.filename}</td><td>{new Date(item.created_at).toLocaleString("es-CO")}</td><td>{item.rows_imported}</td><td>{item.rows_duplicate}</td><td>{item.rows_rejected}</td></tr>)}</tbody></table></div></article> : null}
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
