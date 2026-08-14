import type { ParsedMoney } from "./domain.js";

const ZERO_DECIMAL_CURRENCIES = new Set(["COP", "JPY", "KRW", "CLP", "PYG", "VND"]);

const CURRENCY_MARKERS: Array<{ pattern: RegExp; currency: string; weight: number }> = [
  { pattern: /\bCOP\b/iu, currency: "COP", weight: 1 },
  { pattern: /\bUSD\b|US\$/iu, currency: "USD", weight: 1 },
  { pattern: /\bEUR\b|€/iu, currency: "EUR", weight: 1 },
  { pattern: /\bGBP\b|£/iu, currency: "GBP", weight: 1 },
  { pattern: /\bMXN\b/iu, currency: "MXN", weight: 1 },
  { pattern: /\bCAD\b/iu, currency: "CAD", weight: 1 },
  { pattern: /\bBRL\b|R\$/iu, currency: "BRL", weight: 1 },
];

const MONEY_CONTEXT = /compra|pago|pagaste|debit|débito|debitado|spent|charged|purchase|retiro|withdraw|abono|acredit|recib|deposit|transfer|valor|monto|total/iu;

export function currencyExponent(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

export function toMinorUnits(value: string | number, currency: string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("Money value must be a finite non-negative number.");
    }
    return Math.round(value * 10 ** currencyExponent(currency));
  }

  const parsed = parseNumericToken(value, currencyExponent(currency));
  if (parsed === null || parsed < 0) {
    throw new Error(`Invalid money value: ${value}`);
  }
  return Math.round(parsed * 10 ** currencyExponent(currency));
}

export function fromMinorUnits(amountMinor: number, currency: string): number {
  assertSafeMinor(amountMinor);
  return amountMinor / 10 ** currencyExponent(currency);
}

export function formatMinor(
  amountMinor: number,
  currency: string,
  locale = "es-CO",
): string {
  assertSafeMinor(amountMinor);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: currencyExponent(currency),
    maximumFractionDigits: currencyExponent(currency),
  }).format(fromMinorUnits(amountMinor, currency));
}

export function parseLocalizedMoney(text: string, defaultCurrency = "COP"): ParsedMoney | null {
  const normalized = text.normalize("NFKC");
  const currency = detectCurrency(normalized, defaultCurrency);
  const exponent = currencyExponent(currency);
  const tokenPattern = /(?:\d{1,3}(?:[.,\s]\d{3})+|\d+)(?:[.,]\d{1,2})?/gu;
  const candidates: Array<{ raw: string; value: number; score: number; index: number }> = [];

  for (const match of normalized.matchAll(tokenPattern)) {
    const raw = match[0];
    const digitsOnly = raw.replace(/\D/gu, "");
    if (digitsOnly.length === 0 || digitsOnly.length > 12) continue;

    const value = parseNumericToken(raw, exponent);
    if (value === null || value <= 0) continue;

    const index = match.index ?? 0;
    const context = normalized.slice(Math.max(0, index - 18), index + raw.length + 18);
    const hasNearbyCurrency = /\b(?:COP|USD|EUR|GBP|MXN|CAD|BRL)\b|US\$|R\$|[$€£]/iu.test(context);
    const isLikelyYear = Number.isInteger(value) && value >= 1900 && value <= 2100;

    let score = 0;
    if (hasNearbyCurrency) score += 5;
    if (MONEY_CONTEXT.test(context)) score += 3;
    if (digitsOnly.length >= 3) score += 1;
    if (isLikelyYear && !hasNearbyCurrency) score -= 5;
    if (value >= 1) score += Math.min(2, Math.log10(value + 1) / 3);

    candidates.push({ raw, value, score, index });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score || b.value - a.value || a.index - b.index);
  const selected = candidates[0];
  if (!selected || selected.score < 0) return null;

  const amountMinor = Math.round(selected.value * 10 ** exponent);
  assertSafeMinor(amountMinor);

  return {
    amountMinor,
    currency,
    rawAmount: selected.raw,
    confidence: Math.min(1, 0.55 + Math.max(0, selected.score) * 0.05),
  };
}

function detectCurrency(text: string, defaultCurrency: string): string {
  const explicit = CURRENCY_MARKERS
    .filter((marker) => marker.pattern.test(text))
    .sort((a, b) => b.weight - a.weight)[0];

  if (explicit) return explicit.currency;

  // A lone dollar sign is ambiguous, so respect the user's configured currency.
  if (text.includes("$") && defaultCurrency.toUpperCase() === "USD") return "USD";
  return defaultCurrency.toUpperCase();
}

function parseNumericToken(raw: string, exponent: number): number | null {
  const token = raw.replace(/\s+/gu, "").replace(/[^0-9.,+-]/gu, "");
  if (!token || !/[0-9]/u.test(token)) return null;

  const sign = token.startsWith("-") ? -1 : 1;
  const unsigned = token.replace(/^[+-]/u, "");
  const dotPositions = positionsOf(unsigned, ".");
  const commaPositions = positionsOf(unsigned, ",");
  let normalized: string;

  if (dotPositions.length > 0 && commaPositions.length > 0) {
    const lastDot = dotPositions.at(-1) ?? -1;
    const lastComma = commaPositions.at(-1) ?? -1;
    const decimalSeparator = lastDot > lastComma ? "." : ",";
    const lastIndex = Math.max(lastDot, lastComma);
    const trailingDigits = unsigned.length - lastIndex - 1;

    if (trailingDigits > 0 && trailingDigits <= 2 && exponent > 0) {
      const thousandsSeparator = decimalSeparator === "." ? "," : ".";
      normalized = unsigned.replaceAll(thousandsSeparator, "").replace(decimalSeparator, ".");
    } else {
      normalized = unsigned.replace(/[.,]/gu, "");
    }
  } else {
    const separator = dotPositions.length > 0 ? "." : commaPositions.length > 0 ? "," : null;
    if (!separator) {
      normalized = unsigned;
    } else {
      const parts = unsigned.split(separator);
      const lastPart = parts.at(-1) ?? "";
      const separatorCount = parts.length - 1;
      const decimalLike = exponent > 0 && lastPart.length > 0 && lastPart.length <= 2;

      if (separatorCount === 1 && decimalLike) {
        normalized = `${parts[0] ?? "0"}.${lastPart}`;
      } else if (separatorCount > 1 && decimalLike) {
        normalized = `${parts.slice(0, -1).join("")}.${lastPart}`;
      } else {
        normalized = parts.join("");
      }
    }
  }

  const parsed = Number(normalized) * sign;
  return Number.isFinite(parsed) ? parsed : null;
}

function positionsOf(value: string, token: string): number[] {
  const positions: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === token) positions.push(index);
  }
  return positions;
}

function assertSafeMinor(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new Error("Money amount exceeds JavaScript safe integer range.");
  }
}

/** Convert an amount expressed in minor units using a major-unit FX rate.
 * Example: rate=4000 for USD->COP means 1 USD = 4000 COP.
 */
export function convertMinorUnits(
  amountMinor: number,
  fromCurrency: string,
  toCurrency: string,
  rate: number,
): number {
  assertSafeMinor(amountMinor);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("FX rate must be a positive finite number.");
  if (fromCurrency.toUpperCase() === toCurrency.toUpperCase()) return amountMinor;
  const major = fromMinorUnits(amountMinor, fromCurrency);
  const converted = Math.round(major * rate * 10 ** currencyExponent(toCurrency));
  assertSafeMinor(converted);
  return converted;
}

export function normalizeCurrencyCodes(values: string[], baseCurrency: string, max = 20): string[] {
  const base = baseCurrency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/u.test(base)) throw new Error("Invalid base currency.");
  const normalized = [...new Set([base, ...values.map((value) => value.trim().toUpperCase())])]
    .filter((value) => /^[A-Z]{3}$/u.test(value));
  if (normalized.length > max) throw new Error(`At most ${max} currencies can be enabled.`);
  return normalized;
}
