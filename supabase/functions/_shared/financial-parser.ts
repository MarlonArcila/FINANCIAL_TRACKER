import { sha256Base64Url } from "./crypto.ts";

export type Provider = "android_notification" | "gmail";
export type CandidateKind = "income" | "expense";

export interface ParsedCandidate {
  localId: string;
  provider: Provider;
  externalId: string | null;
  appPackage: string | null;
  occurredAt: string;
  proposedKind: CandidateKind;
  amountMinor: number;
  currency: string;
  merchant: string | null;
  description: string | null;
  confidence: number;
  fingerprint: string;
  dedupeKey: string;
  reasons: string[];
  parserVersion: string;
  senderNormalized?: string | null;
  titleSanitized?: string | null;
}

const VERSION = "edge-2026-09-03.1";
const ZERO_DECIMAL = new Set(["COP", "JPY", "KRW", "CLP", "PYG", "VND"]);
const EXPENSE = [
  // Spanish and English.
  "compra", "pago realizado", "pagaste", "debitado", "debito", "retiro", "transferencia enviada",
  "spent", "charged", "purchase", "withdrawal", "payment sent", "paid", "debited", "card purchase",
  "transaction was successful at", "transaction successful at",
  // Portuguese, French, German, Italian, Dutch and Polish (accent-insensitive normalization).
  "pagamento realizado", "pagou", "saque", "transferencia enviada",
  "achat", "paiement effectue", "paye", "debite", "retrait", "virement envoye",
  "kauf", "bezahlt", "belastet", "abbuchung", "abhebung", "uberweisung gesendet",
  "acquisto", "pagamento effettuato", "pagato", "addebitato", "prelievo", "bonifico inviato",
  "aankoop", "betaling gedaan", "betaald", "afgeschreven", "opname", "overschrijving verzonden",
  "zakup", "platnosc wykonana", "zaplacono", "obciazono", "wyplata", "przelew wyslany",
  // Turkish and Indonesian.
  "\u00f6deme yap\u0131ld\u0131", "\u00f6dendi", "bor\u00e7land\u0131r\u0131ld\u0131", "para \u00e7ekme", "transfer g\u00f6nderildi",
  "pembelian", "pembayaran dilakukan", "dibayar", "didebit", "penarikan", "transfer dikirim",
  // Chinese, Japanese and Korean.
  "\u8d2d\u4e70", "\u8cfc\u8cb7", "\u652f\u4ed8", "\u6263\u6b3e", "\u5df2\u6263\u6b3e", "\u53d6\u6b3e", "\u8f6c\u51fa", "\u8f49\u51fa",
  "\u8cfc\u5165", "\u652f\u6255\u3044", "\u6c7a\u6e08", "\u5f15\u304d\u843d\u3068\u3057", "\u51fa\u91d1", "\u9001\u91d1\u3057\u307e\u3057\u305f",
  "\uad6c\ub9e4", "\uacb0\uc81c", "\ucd9c\uae08", "\uc1a1\uae08 \uc644\ub8cc",
  // Arabic and Hindi.
  "\u0634\u0631\u0627\u0621", "\u062a\u0645 \u0627\u0644\u062f\u0641\u0639", "\u0645\u062f\u0641\u0648\u0639", "\u062e\u0635\u0645", "\u0633\u062d\u0628", "\u062a\u062d\u0648\u064a\u0644 \u0645\u0631\u0633\u0644",
  "\u0916\u0930\u0940\u0926", "\u092d\u0941\u0917\u0924\u093e\u0928 \u0915\u093f\u092f\u093e", "\u0921\u0947\u092c\u093f\u091f", "\u0928\u093f\u0915\u093e\u0938\u0940", "\u0905\u0902\u0924\u0930\u0923 \u092d\u0947\u091c\u093e",
];
const INCOME = [
  // Spanish and English.
  "abono", "abonado", "acreditado", "consignacion", "deposito recibido", "recibiste", "transferencia recibida",
  "credited", "payment received", "you received", "incoming transfer", "deposit received", "funds received",
  // Portuguese, French, German, Italian, Dutch and Polish.
  "creditado", "pagamento recebido", "recebeu", "transferencia recebida", "deposito recebido",
  "credite", "paiement recu", "virement recu", "depot recu",
  "gutgeschrieben", "zahlung erhalten", "uberweisung erhalten", "einzahlung erhalten", "geldeingang",
  "accreditato", "pagamento ricevuto", "bonifico ricevuto", "deposito ricevuto",
  "bijgeschreven", "betaling ontvangen", "overschrijving ontvangen", "storting ontvangen",
  "uznano", "platnosc otrzymana", "przelew otrzymany", "wplata",
  // Turkish and Indonesian.
  "\u00f6deme al\u0131nd\u0131", "hesaba ge\u00e7ti", "gelen transfer",
  "pembayaran diterima", "diterima", "transfer masuk", "dikreditkan",
  // Chinese, Japanese and Korean.
  "\u6536\u5230", "\u6536\u6b3e", "\u5165\u8d26", "\u5165\u8cec", "\u5230\u8d26", "\u5230\u8cec", "\u8f6c\u5165", "\u8f49\u5165",
  "\u5165\u91d1", "\u53d7\u3051\u53d6\u308a", "\u632f\u8fbc\u5165\u91d1",
  "\uc785\uae08", "\uacb0\uc81c \uc785\uae08", "\uc774\uccb4 \uc785\uae08", "\uc218\uc2e0",
  // Arabic and Hindi.
  "\u062a\u0645 \u0627\u0644\u0627\u0633\u062a\u0644\u0627\u0645", "\u0627\u0633\u062a\u0644\u0627\u0645", "\u0625\u064a\u062f\u0627\u0639", "\u062a\u062d\u0648\u064a\u0644 \u0648\u0627\u0631\u062f",
  "\u092a\u094d\u0930\u093e\u092a\u094d\u0924", "\u091c\u092e\u093e", "\u0915\u094d\u0930\u0947\u0921\u093f\u091f", "\u092d\u0941\u0917\u0924\u093e\u0928 \u092a\u094d\u0930\u093e\u092a\u094d\u0924", "\u0905\u0902\u0924\u0930\u0923 \u092a\u094d\u0930\u093e\u092a\u094d\u0924",
];
const NOISE = /otp|one[- ]time password|c[oó]digo de verificaci[oó]n|clave din[aá]mica|verification code|promoci[oó]n|oferta|cup[oó]n|saldo disponible|available balance/iu;
const FAILURE = /fallid[oa]|rechazad[oa]|declined|failed|cancelad[oa]/iu;

export async function parseMailMessage(input: {
  provider: "gmail";
  externalId: string;
  occurredAt: string;
  sender: string | null;
  title: string | null;
  text: string;
  defaultCurrency: string;
}): Promise<ParsedCandidate | null> {
  const combined = [input.title, input.sender, input.text].filter(Boolean).join(" | ");
  const normalized = normalize(combined);
  if (NOISE.test(combined) || FAILURE.test(combined)) return null;

  const money = parseMoney(combined, input.defaultCurrency);
  if (!money) return null;
  const direction = classify(normalized);
  if (!direction) return null;
  const merchant = inferMerchant(input.text, input.title, input.sender);
  const description = sanitize([input.title, input.text].filter(Boolean).join(" — ")) || null;
  const occurredAt = normalizeDate(input.occurredAt);
  const confidence = Math.min(0.99, 0.45 + money.confidence * 0.3 + direction.confidence * 0.22 + (merchant ? 0.03 : 0));
  if (confidence < 0.58) return null;

  const fingerprint = await sha256Base64Url(`${input.provider}|${input.externalId}`);
  const dedupeKey = await canonicalDedupeKey(direction.kind, money.amountMinor, money.currency, merchant);
  return {
    localId: input.externalId,
    provider: input.provider,
    externalId: input.externalId,
    appPackage: null,
    occurredAt,
    proposedKind: direction.kind,
    amountMinor: money.amountMinor,
    currency: money.currency,
    merchant,
    description,
    confidence: Number(confidence.toFixed(4)),
    fingerprint,
    dedupeKey,
    reasons: [`Amount detected as ${money.raw}.`, `${direction.kind} signal detected.`],
    parserVersion: VERSION,
    senderNormalized: input.sender ? sanitize(input.sender, 160) : null,
    titleSanitized: input.title ? sanitize(input.title, 200) : null,
  };
}

export async function validateDeviceCandidate(value: unknown): Promise<ParsedCandidate | null> {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const provider = item.provider;
  const kind = item.proposedKind;
  const amount = item.amountMinor;
  const confidence = item.confidence;
  if (provider !== "android_notification" || (kind !== "income" && kind !== "expense")) return null;
  if (!Number.isSafeInteger(amount) || Number(amount) <= 0) return null;
  if (typeof item.currency !== "string" || !/^[A-Z]{3}$/u.test(item.currency)) return null;
  if (typeof item.localId !== "string" || item.localId.length < 1 || item.localId.length > 160) return null;
  if (typeof item.occurredAt !== "string" || Number.isNaN(Date.parse(item.occurredAt))) return null;
  if (typeof confidence !== "number" || confidence < 0 || confidence > 1) return null;
  const localId = item.localId;
  const appPackage = typeof item.appPackage === "string" ? item.appPackage.slice(0, 250) : null;
  const merchant = typeof item.merchant === "string" ? sanitize(item.merchant, 80) : null;
  const currency = normalizeCurrency(item.currency);
  const fingerprint = await sha256Base64Url(`android_notification|${appPackage ?? ""}|${localId}`);
  const dedupeKey = await canonicalDedupeKey(kind, Number(amount), currency, merchant);
  return {
    localId,
    provider,
    externalId: typeof item.externalId === "string" ? item.externalId.slice(0, 250) : null,
    appPackage,
    occurredAt: new Date(item.occurredAt).toISOString(),
    proposedKind: kind,
    amountMinor: Number(amount),
    currency,
    merchant,
    description: typeof item.description === "string" ? sanitize(item.description, 500) : null,
    confidence,
    fingerprint,
    dedupeKey,
    reasons: Array.isArray(item.reasons) ? item.reasons.filter((reason): reason is string => typeof reason === "string").slice(0, 10).map((reason) => sanitize(reason, 200)) : [],
    parserVersion: typeof item.parserVersion === "string" ? item.parserVersion.slice(0, 80) : "android-unknown",
  };
}

export function sanitize(value: string, max = 500): string {
  return value
    .normalize("NFKC")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, "[EMAIL]")
    .replace(/\b(?:otp|c[oó]digo|clave|code)\D{0,12}\d{4,8}\b/giu, "[REDACTED_CODE]")
    .replace(/(?:\d[ -]?){12,19}/gu, "[REDACTED_ACCOUNT]")
    .replace(/\*{2,}\d{2,4}/gu, "[REDACTED_ACCOUNT]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
}

function parseMoney(text: string, defaultCurrency: string): { amountMinor: number; currency: string; raw: string; confidence: number } | null {
  const currency = detectCurrency(text, defaultCurrency);
  const exponent = ZERO_DECIMAL.has(currency) ? 0 : 2;
  const pattern = /(?:\d{1,3}(?:[.,\s]\d{3})+|\d+)(?:[.,]\d{1,2})?/gu;
  const values: Array<{ raw: string; value: number; score: number }> = [];
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const value = parseToken(raw, exponent);
    if (value === null || value <= 0 || value > 9_007_199_254_740_991) continue;
    const index = match.index ?? 0;
    const context = text.slice(Math.max(0, index - 22), index + raw.length + 22);
    let score = /\b(?:COP|USD|EUR|GBP|MXN|CAD|BRL|JPY|KRW|CLP|PYG|VND|CNY|INR|AUD|NZD|CHF|SGD|HKD|TRY)\b|US\$|R\$|[$\u20ac\u00a3\u20b9\u20a9\u20ba]/iu.test(context) ? 5 : 0;
    const directionContext = normalize(context);
    if (EXPENSE.some((word) => directionContext.includes(normalize(word))) || INCOME.some((word) => directionContext.includes(normalize(word)))) score += 3;
    if (value >= 1900 && value <= 2100 && !/[$€£]/u.test(context)) score -= 5;
    values.push({ raw, value, score });
  }
  values.sort((a, b) => b.score - a.score || b.value - a.value);
  const selected = values[0];
  if (!selected || selected.score < 0) return null;
  const amountMinor = Math.round(selected.value * 10 ** exponent);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  return { amountMinor, currency, raw: selected.raw, confidence: Math.min(1, 0.6 + selected.score * 0.05) };
}

function parseToken(raw: string, exponent: number): number | null {
  const token = raw.replace(/\s+/gu, "");
  const lastDot = token.lastIndexOf(".");
  const lastComma = token.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const last = Math.max(lastDot, lastComma);
    const trailing = token.length - last - 1;
    normalized = trailing <= 2 && exponent > 0
      ? token.replaceAll(decimal === "." ? "," : ".", "").replace(decimal, ".")
      : token.replace(/[.,]/gu, "");
  } else {
    const separator = lastDot >= 0 ? "." : lastComma >= 0 ? "," : null;
    if (!separator) normalized = token;
    else {
      const parts = token.split(separator);
      const tail = parts.at(-1) ?? "";
      normalized = exponent > 0 && tail.length > 0 && tail.length <= 2 && parts.length === 2
        ? `${parts[0]}.${tail}`
        : parts.join("");
    }
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function detectCurrency(text: string, fallback: string): string {
  const codes = ["COP", "USD", "EUR", "GBP", "MXN", "CAD", "BRL", "JPY", "KRW", "CLP", "PYG", "VND", "CNY", "INR", "AUD", "NZD", "CHF", "SGD", "HKD", "TRY"];
  for (const code of codes) {
    if (new RegExp(`(?:^|[^A-Z0-9])${code}(?:$|[^A-Z0-9])`, "iu").test(text)) return code;
  }
  if (/US\$/iu.test(text)) return "USD";
  if (/R\$/iu.test(text)) return "BRL";
  if (/\u20ac/u.test(text)) return "EUR";
  if (/\u00a3/u.test(text)) return "GBP";
  if (/\u20b9/u.test(text)) return "INR";
  if (/\u20a9/u.test(text)) return "KRW";
  if (/\u20ba/u.test(text)) return "TRY";
  return normalizeCurrency(fallback);
}

function classify(normalized: string): { kind: CandidateKind; confidence: number } | null {
  const expense = EXPENSE.filter((word) => normalized.includes(normalize(word))).length;
  const income = INCOME.filter((word) => normalized.includes(normalize(word))).length;
  if (expense === income) return null;
  return { kind: expense > income ? "expense" : "income", confidence: Math.min(1, 0.65 + Math.abs(expense - income) * 0.1) };
}

function inferMerchant(text: string, title: string | null, sender: string | null): string | null {
  const match = text.match(/\b(?:en|at|comercio|merchant|desde|from)\s+([\p{L}\p{N}][\p{L}\p{N}&'’._\- ]{1,80})/iu);
  if (match?.[1]) return sanitize(match[1].split(/\b(?:con|por|tarjeta|cuenta|using|on)\b/iu)[0] ?? match[1], 80);
  const titleValue = title ? sanitize(title, 80) : "";
  if (titleValue && !/banco|bank|notificaci[oó]n|payment|pago/iu.test(titleValue)) return titleValue;
  if (sender) return sanitize(sender.split("<")[0] ?? sender, 80) || null;
  return null;
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

async function canonicalDedupeKey(kind: CandidateKind, amountMinor: number, currency: string, merchant: string | null): Promise<string> {
  // Timestamp is checked separately by the ingestion window so adjacent clock buckets still deduplicate.
  return sha256Base64Url(`${kind}|${amountMinor}|${normalizeCurrency(currency)}|${normalizeKeyText(merchant ?? "unknown")}`);
}

function normalizeCurrency(value: string): string {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/u.test(normalized) ? normalized : "COP";
}

function normalizeKeyText(value: string): string {
  return normalize(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function normalizeDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
