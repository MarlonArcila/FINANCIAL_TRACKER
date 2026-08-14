const STOP_WORDS = /\b(?:por|con|desde|from|el|la|los|las|una|un|tarjeta|cuenta|valor|monto|total|on|using)\b/iu;

export function extractMerchant(text: string, title?: string, sender?: string): string | null {
  const normalized = `${title ?? ""} ${text}`.normalize("NFKC");
  const patterns = [
    /\b(?:en|at|comercio|merchant)\s+([\p{L}\p{N}][\p{L}\p{N}&'’._\- ]{1,80})/iu,
    /\b(?:a|to)\s+([\p{L}\p{N}][\p{L}\p{N}&'’._\- ]{1,80})/iu,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const raw = match?.[1];
    if (!raw) continue;
    const cleaned = cleanMerchant(raw);
    if (cleaned.length >= 2) return cleaned;
  }

  if (title) {
    const cleanedTitle = cleanMerchant(title);
    if (cleanedTitle.length >= 2 && !/banco|bank|wallet|notificación|notification/iu.test(cleanedTitle)) {
      return cleanedTitle;
    }
  }

  if (sender) {
    const senderName = sender.split("<")[0]?.trim() ?? "";
    const cleanedSender = cleanMerchant(senderName);
    if (cleanedSender.length >= 2) return cleanedSender;
  }

  return null;
}

function cleanMerchant(raw: string): string {
  const beforeStop = raw.split(STOP_WORDS)[0] ?? raw;
  return beforeStop
    .replace(/\s+/gu, " ")
    .replace(/[.,;:!?]+$/gu, "")
    .trim()
    .slice(0, 80);
}
