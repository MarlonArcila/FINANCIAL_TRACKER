export type ImportField =
  | "date"
  | "amount"
  | "income"
  | "expense"
  | "kind"
  | "merchant"
  | "description"
  | "category"
  | "account"
  | "currency";

export type ImportMapping = Partial<Record<ImportField, string>>;

export interface ImportTable {
  headers: string[];
  rows: Array<Record<string, string>>;
}

export interface NormalizeImportOptions {
  defaultCurrency: string;
  defaultKind?: "income" | "expense";
  dayFirst?: boolean;
}

export interface NormalizedImportRow {
  source_row: number;
  occurred_at: string;
  kind: "income" | "expense";
  amount_minor: number;
  currency: string;
  merchant: string | null;
  description: string | null;
  category_name: string | null;
  account_name: string | null;
}

export interface ImportRowError {
  sourceRow: number;
  message: string;
}

export interface NormalizeImportResult {
  rows: NormalizedImportRow[];
  errors: ImportRowError[];
}

const FIELD_HINTS: Record<ImportField, RegExp[]> = {
  date: [/^fecha$/u, /fecha.*mov/u, /date/u, /posted.*date/u, /transaction.*date/u, /created.*at/u],
  amount: [/^monto$/u, /^valor$/u, /^importe$/u, /^amount$/u, /transaction.*amount/u, /^total$/u],
  income: [/^ingreso/u, /^abono/u, /^credito$/u, /^credit$/u, /money.*in/u, /deposit/u],
  expense: [/^gasto/u, /^debito$/u, /^debit$/u, /money.*out/u, /^cargo/u, /^retiro/u, /^withdraw/u],
  kind: [/^tipo$/u, /tipo.*mov/u, /^kind$/u, /^type$/u, /transaction.*type/u, /^direccion$/u, /^direction$/u],
  merchant: [/comercio/u, /merchant/u, /beneficiario/u, /payee/u, /establecimiento/u, /contraparte/u],
  description: [/descripcion/u, /description/u, /^detalle/u, /^concepto/u, /^memo$/u, /^nota/u, /^notes$/u],
  category: [/categoria/u, /category/u, /^rubro/u, /^tag$/u],
  account: [/^cuenta$/u, /account/u, /wallet/u, /billetera/u, /producto/u],
  currency: [/moneda/u, /currency/u, /^divisa$/u, /^iso$/u],
};

export function parseDelimitedText(text: string, delimiter?: string): ImportTable {
  const clean = text.replace(/^\uFEFF/u, "");
  const separator = delimiter ?? detectDelimiter(clean);
  const matrix = parseDelimitedMatrix(clean, separator);
  if (!matrix.length) return { headers: [], rows: [] };
  const headerRow = matrix[0] ?? [];
  const headers = makeUniqueHeaders(headerRow.map((value, index) => value.trim() || `Columna ${index + 1}`));
  const rows = matrix.slice(1)
    .filter((row) => row.some((value) => value.trim() !== ""))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() ?? ""])));
  return { headers, rows };
}

export function parseJsonTable(value: unknown): ImportTable {
  const source = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.transactions)
      ? value.transactions
      : isRecord(value) && Array.isArray(value.rows)
        ? value.rows
        : null;
  if (!source) throw new Error("El JSON debe contener un arreglo de movimientos, 'transactions' o 'rows'.");
  const records = source.filter(isRecord);
  const headers = makeUniqueHeaders([...new Set(records.flatMap((row) => Object.keys(row)))].map((value) => value.trim()).filter(Boolean));
  const rows = records.map((row) => Object.fromEntries(headers.map((header) => [header, stringifyCell(row[header])])));
  return { headers, rows };
}

export function guessImportMapping(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  const normalizedHeaders = headers.map((header) => ({ header, normalized: normalizeHeader(header) }));
  for (const field of Object.keys(FIELD_HINTS) as ImportField[]) {
    const match = normalizedHeaders.find(({ normalized }) => FIELD_HINTS[field].some((pattern) => pattern.test(normalized)));
    if (match) mapping[field] = match.header;
  }
  if (mapping.income || mapping.expense) delete mapping.amount;
  return mapping;
}

export function normalizeImportRows(
  rows: Array<Record<string, string>>,
  mapping: ImportMapping,
  options: NormalizeImportOptions,
): NormalizeImportResult {
  const normalized: NormalizedImportRow[] = [];
  const errors: ImportRowError[] = [];
  const defaultCurrency = options.defaultCurrency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/u.test(defaultCurrency)) throw new Error("La moneda predeterminada debe ser un código ISO de 3 letras.");

  rows.forEach((row, index) => {
    const sourceRow = index + 2;
    try {
      const occurredAt = parseImportDate(cell(row, mapping.date), options.dayFirst ?? true);
      const money = resolveMoney(row, mapping, options.defaultKind ?? "expense");
      const currencyRaw = cell(row, mapping.currency).trim().toUpperCase();
      const currency = currencyRaw || defaultCurrency;
      if (!/^[A-Z]{3}$/u.test(currency)) throw new Error(`moneda inválida: ${currency || "vacía"}`);
      normalized.push({
        source_row: sourceRow,
        occurred_at: occurredAt,
        kind: money.kind,
        amount_minor: money.amountMinor,
        currency,
        merchant: nullable(cell(row, mapping.merchant)),
        description: nullable(cell(row, mapping.description)),
        category_name: nullable(cell(row, mapping.category)),
        account_name: nullable(cell(row, mapping.account)),
      });
    } catch (error) {
      errors.push({ sourceRow, message: error instanceof Error ? error.message : "fila inválida" });
    }
  });
  return { rows: normalized, errors };
}

export function parseMoneyToMinor(value: string): number {
  const normalized = normalizeNumber(value);
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) throw new Error(`monto inválido: ${value || "vacío"}`);
  const minor = Math.round(Math.abs(numeric) * 100);
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error("el monto debe ser mayor que cero");
  return minor;
}

export function parseImportDate(value: string, dayFirst = true): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("fecha vacía");

  if (/^\d{4}-\d{1,2}-\d{1,2}(?:[T\s].*)?$/u.test(trimmed)) {
    const parsed = new Date(trimmed.length <= 10 ? `${trimmed}T12:00:00.000Z` : trimmed);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }

  if (/^\d+(?:\.\d+)?$/u.test(trimmed)) {
    const serial = Number(trimmed);
    if (serial > 20_000 && serial < 80_000) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      return new Date(excelEpoch + serial * 86_400_000).toISOString();
    }
  }

  const match = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})(?:[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/u);
  if (match) {
    let first = Number(match[1]);
    let second = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const day = dayFirst ? first : second;
    const month = dayFirst ? second : first;
    const date = new Date(Date.UTC(year, month - 1, day, Number(match[4] ?? 12), Number(match[5] ?? 0), Number(match[6] ?? 0)));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error(`fecha inválida: ${value}`);
    return date.toISOString();
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  throw new Error(`fecha inválida: ${value}`);
}

function resolveMoney(row: Record<string, string>, mapping: ImportMapping, defaultKind: "income" | "expense") {
  const incomeRaw = cell(row, mapping.income);
  const expenseRaw = cell(row, mapping.expense);
  if (incomeRaw.trim() || expenseRaw.trim()) {
    const incomeValue = incomeRaw.trim() ? signedNumber(incomeRaw) : 0;
    const expenseValue = expenseRaw.trim() ? signedNumber(expenseRaw) : 0;
    if (Math.abs(incomeValue) > 0 && Math.abs(expenseValue) > 0) throw new Error("la fila tiene ingreso y gasto al mismo tiempo");
    if (Math.abs(incomeValue) > 0) return { kind: "income" as const, amountMinor: Math.round(Math.abs(incomeValue) * 100) };
    if (Math.abs(expenseValue) > 0) return { kind: "expense" as const, amountMinor: Math.round(Math.abs(expenseValue) * 100) };
    throw new Error("monto vacío");
  }

  const raw = cell(row, mapping.amount);
  if (!raw.trim()) throw new Error("monto vacío");
  const numeric = signedNumber(raw);
  if (!Number.isFinite(numeric) || numeric === 0) throw new Error(`monto inválido: ${raw}`);
  const kindCell = classifyKind(cell(row, mapping.kind));
  const kind = kindCell ?? (numeric < 0 ? "expense" : defaultKind);
  const amountMinor = Math.round(Math.abs(numeric) * 100);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error("monto fuera de rango");
  return { kind, amountMinor };
}

function signedNumber(value: string): number {
  let sign = 1;
  const trimmed = value.trim();
  if (/^\(.*\)$/u.test(trimmed) || /^-/u.test(trimmed)) sign = -1;
  const normalized = normalizeNumber(trimmed);
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) throw new Error(`monto inválido: ${value}`);
  return Math.abs(numeric) * sign;
}

function normalizeNumber(value: string): string {
  let raw = value.trim().replace(/[\s\u00A0]/gu, "").replace(/[^0-9,\.\-()]/gu, "");
  raw = raw.replace(/[()\-]/gu, "");
  if (!raw) return "NaN";
  const commas = [...raw.matchAll(/,/gu)].map((match) => match.index ?? -1);
  const dots = [...raw.matchAll(/\./gu)].map((match) => match.index ?? -1);
  if (commas.length && dots.length) {
    const decimal = commas.at(-1)! > dots.at(-1)! ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    raw = raw.replaceAll(thousands, "");
    if (decimal === ",") raw = raw.replaceAll(",", ".");
    return raw;
  }
  const separator = commas.length ? "," : dots.length ? "." : null;
  if (!separator) return raw;
  const parts = raw.split(separator);
  if (parts.length > 2) {
    const last = parts.at(-1)!;
    if (last.length <= 2) return `${parts.slice(0, -1).join("")}.${last}`;
    return parts.join("");
  }
  const fraction = parts[1] ?? "";
  if (fraction.length === 1 || fraction.length === 2) return `${parts[0]}.${fraction}`;
  return parts.join("");
}

function classifyKind(value: string): "income" | "expense" | null {
  const normalized = normalizeHeader(value);
  if (!normalized) return null;
  if (/ingreso|abono|deposit|credit|credito|recib|income|entrada|refund|reembolso/u.test(normalized)) return "income";
  if (/gasto|compra|pago|debit|debito|cargo|retiro|expense|salida|withdraw|charge/u.test(normalized)) return "expense";
  return null;
}

function detectDelimiter(text: string): string {
  const firstLines = text.split(/\r?\n/u).slice(0, 8).filter(Boolean);
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestScore = -1;
  for (const delimiter of candidates) {
    const counts = firstLines.map((line) => countOutsideQuotes(line, delimiter));
    const positive = counts.filter((count) => count > 0);
    if (!positive.length) continue;
    const score = positive.length * 10 - (Math.max(...positive) - Math.min(...positive));
    if (score > bestScore) { best = delimiter; bestScore = score; }
  }
  return best;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let quoted = false;
  let count = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') {
      if (quoted && line[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && line[index] === delimiter) count += 1;
  }
  return count;
}

function parseDelimitedMatrix(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"' && cell === "") { quoted = true; continue; }
    if (char === delimiter) { row.push(cell); cell = ""; continue; }
    if (char === "\n") { row.push(cell.replace(/\r$/u, "")); rows.push(row); row = []; cell = ""; continue; }
    cell += char;
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/u, "")); rows.push(row); }
  return rows;
}

function makeUniqueHeaders(headers: string[]): string[] {
  const counts = new Map<string, number>();
  return headers.map((header) => {
    const base = header || "Columna";
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function normalizeHeader(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

function cell(row: Record<string, string>, header: string | undefined): string {
  return header ? row[header] ?? "" : "";
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 300) : null;
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
