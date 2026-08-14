import { guessImportMapping, parseDelimitedText, parseJsonTable, type ImportMapping, type ImportTable } from "@capitalflow/core";

export interface ParsedImportFile extends ImportTable {
  filename: string;
  fileType: "csv" | "tsv" | "txt" | "xlsx" | "xls" | "json";
  mapping: ImportMapping;
  sheetName: string | null;
  sha256: string;
}

const MAX_IMPORT_BYTES = 15 * 1024 * 1024;

export async function readImportFile(file: File): Promise<ParsedImportFile> {
  if (file.size <= 0) throw new Error("El archivo está vacío.");
  if (file.size > MAX_IMPORT_BYTES) throw new Error("El archivo supera el límite de 15 MB del MVP.");
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  const sha256 = await sha256File(file);
  let table: ImportTable;
  let sheetName: string | null = null;
  let fileType: ParsedImportFile["fileType"];

  if (["csv", "tsv", "txt"].includes(extension)) {
    fileType = extension as "csv" | "tsv" | "txt";
    table = parseDelimitedText(await file.text(), extension === "tsv" ? "\t" : undefined);
  } else if (extension === "json") {
    fileType = "json";
    table = parseJsonTable(JSON.parse(await file.text()));
  } else if (extension === "xlsx" || extension === "xls") {
    fileType = extension;
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: false, cellDates: false });
    sheetName = workbook.SheetNames.find((name) => Boolean(workbook.Sheets[name]?.["!ref"])) ?? workbook.SheetNames[0] ?? null;
    if (!sheetName) throw new Error("El libro no contiene hojas legibles.");
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName]!, { header: 1, raw: false, defval: "" });
    if (!matrix.length) throw new Error("La hoja seleccionada está vacía.");
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]!, { FS: "\t", RS: "\n" });
    table = parseDelimitedText(csv, "\t");
  } else {
    throw new Error("Formato no soportado. Usa CSV, TSV, TXT, XLSX, XLS o JSON.");
  }

  if (!table.headers.length || !table.rows.length) throw new Error("No se encontraron filas de movimientos.");
  return { ...table, filename: file.name, fileType, mapping: guessImportMapping(table.headers), sheetName, sha256 };
}

async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
