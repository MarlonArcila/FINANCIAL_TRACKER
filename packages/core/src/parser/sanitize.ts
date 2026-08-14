export function sanitizeFinancialText(input: string, maxLength = 500): string {
  return input
    .normalize("NFKC")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, "[EMAIL]")
    .replace(/\b(?:otp|c[oó]digo|clave|code)\D{0,12}\d{4,8}\b/giu, "[REDACTED_CODE]")
    .replace(/(?:\d[ -]?){12,19}/gu, "[REDACTED_ACCOUNT]")
    .replace(/\*{2,}\d{2,4}/gu, "[REDACTED_ACCOUNT]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}
