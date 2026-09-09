/** Parsed headers are diagnostics, not a trusted authentication boundary. */
export type AuthVerdict = {
  authservId: string;
  method: "dkim" | "spf" | "dmarc" | "arc";
  result: string;
  authenticatedDomain: string | null;
};

export function normalizeAuthDomain(value: string): string | null {
  if (!/^[\x21-\x7e]+$/u.test(value)) return null;
  const domain = value.toLowerCase().replace(/\.$/u, "");
  if (domain.length > 253 || !domain.includes(".")) return null;
  return domain.split(".").every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)
    )
    ? domain
    : null;
}

export function authIdentityDomain(value: string): string | null {
  if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1);
  if (!value.includes("@")) return normalizeAuthDomain(value);
  const match =
    /^([a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*)@([^@]+)$/u
      .exec(value);
  return match ? normalizeAuthDomain(match[2]) : null;
}

export function authDomainMatches(value: string, expected: string): boolean {
  const domain = normalizeAuthDomain(value);
  return domain !== null && domain === normalizeAuthDomain(expected);
}

/** Bounded conservative subset of RFC 8601; ambiguous/malformed input is rejected. */
export function parseAuthenticationResults(raw: string): AuthVerdict[] {
  if (!raw || raw.length > 4000 || /[^\x09\x0a\x0d\x20-\x7e]/u.test(raw)) {
    return [];
  }
  let clean = "", depth = 0, quoted = false, escaped = false;
  for (const char of raw) {
    if (escaped) {
      if (!depth) clean += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && (depth || quoted)) {
      escaped = true;
      continue;
    }
    if (!depth && char === '"') {
      quoted = !quoted;
      clean += char;
      continue;
    }
    if (!quoted && char === "(") {
      if (++depth > 8) return [];
      clean += " ";
      continue;
    }
    if (!quoted && char === ")") {
      if (!depth--) return [];
      continue;
    }
    if (!depth) clean += char;
  }
  if (depth || quoted || escaped) return [];
  clean = clean.replace(/\r?\n[\t ]+/gu, " ");
  if (/[\r\n]/u.test(clean)) return [];
  const clauses = clean.split(";");
  const authservId = normalizeAuthDomain(clauses.shift()?.trim() ?? "");
  if (!authservId || clauses.length > 32) return [];
  const verdicts: AuthVerdict[] = [];
  for (const clause of clauses) {
    const match =
      /^\s*(dkim|spf|dmarc|arc)\s*=\s*(pass|fail|softfail|neutral|none|temperror|permerror|unknown)\b(.*)$/iu
        .exec(clause);
    if (!match) continue;
    const method = match[1].toLowerCase() as AuthVerdict["method"];
    const properties = new Map<string, string>();
    const tail = match[3];
    const token = /\s+([a-z][a-z0-9_.-]*)\s*=\s*("[^";]*"|[^\s;]+)/iy;
    let position = 0;
    while (position < tail.trimEnd().length) {
      token.lastIndex = position;
      const property = token.exec(tail);
      if (!property) return [];
      const key = property[1].toLowerCase();
      if (properties.has(key)) return [];
      properties.set(key, property[2].replace(/^"|"$/gu, ""));
      position = token.lastIndex;
    }
    const identity = properties.get(
      method === "dkim"
        ? "header.d"
        : method === "spf"
        ? "smtp.mailfrom"
        : "header.from",
    );
    verdicts.push({
      authservId,
      method,
      result: match[2].toLowerCase(),
      authenticatedDomain: identity
        ? (method === "spf"
          ? authIdentityDomain(identity)
          : normalizeAuthDomain(identity))
        : null,
    });
  }
  return verdicts;
}

export function originalSenderAuth(): {
  level: "unknown";
  authenticated_domain: null;
  reason: string;
} {
  // Forwarder authentication never authenticates the original financial sender.
  return {
    level: "unknown",
    authenticated_domain: null,
    reason: "original_sender_authentication_unavailable",
  };
}
