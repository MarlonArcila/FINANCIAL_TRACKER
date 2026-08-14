export const PARSER_VERSION = "2026-08-12.1";

export const EXPENSE_STRONG = [
  "compra",
  "compraste",
  "pago realizado",
  "pagaste",
  "debitado",
  "débito",
  "retiro",
  "retiraste",
  "spent",
  "charged",
  "purchase",
  "withdrawal",
  "payment sent",
  "transferencia enviada",
  "enviaste",
] as const;

export const INCOME_STRONG = [
  "abono",
  "abonado",
  "acreditado",
  "consignación",
  "depósito recibido",
  "recibiste",
  "transferencia recibida",
  "credited",
  "deposit received",
  "payment received",
  "you received",
  "incoming transfer",
] as const;

export const EXPENSE_WEAK = ["pago", "cargo", "débito", "transferencia", "purchase"] as const;
export const INCOME_WEAK = ["ingreso", "depósito", "abono", "crédito", "received"] as const;

export const NOISE_PATTERNS = [
  /\b(?:otp|one[- ]time password|código de verificación|codigo de verificacion|clave dinámica|clave dinamica|verification code)\b/iu,
  /\b(?:promoción|promocion|oferta|descuento|cupón|cupon)\b/iu,
  /\b(?:saldo disponible|available balance)\b/iu,
  /\b(?:extracto|statement)\b/iu,
] as const;
