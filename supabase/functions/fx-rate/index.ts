import { optionalEnv } from "../_shared/env.ts";
import { errorResponse, handleOptions, HttpError, json, readJson } from "../_shared/http.ts";
import { withAdditionalCors } from "../_shared/additional-cors.ts";
import { assertEntitled, createServiceClient, requireUser } from "../_shared/supabase.ts";

interface FxRequest {
  base: string;
  quote: string;
  amountMinor?: number;
  forceRefresh?: boolean;
}

const ZERO_DECIMAL = new Set(["COP", "JPY", "KRW", "CLP", "PYG", "VND"]);
const GOOGLE_PROVIDER = "google_finance_web";

Deno.serve((request) => withAdditionalCors(request, async () => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const { user } = await requireUser(request);
    const service = createServiceClient();
    await assertEntitled(service, user.id);
    const body = await readJson<FxRequest>(request, 10_000);
    const base = normalizeCurrency(body.base);
    const quote = normalizeCurrency(body.quote);
    const amountMinor = body.amountMinor;
    if (amountMinor !== undefined && (!Number.isSafeInteger(amountMinor) || amountMinor < 0)) {
      throw new HttpError(422, "invalid_amount_minor");
    }

    if (base === quote) {
      return json({
        base,
        quote,
        rate: 1,
        convertedMinor: amountMinor ?? null,
        provider: "identity",
        sourceLabel: "Misma moneda",
        fetchedAt: new Date().toISOString(),
        warning: "No se aplicó conversión porque la moneda de origen y destino es la misma.",
        cached: true,
      });
    }

    const provider = optionalEnv("FX_PROVIDER") ?? GOOGLE_PROVIDER;
    const result = await getRate(service, base, quote, provider, body.forceRefresh === true);
    return json({
      base,
      quote,
      rate: result.rate,
      convertedMinor: amountMinor === undefined ? null : convertMinor(amountMinor, base, quote, result.rate),
      provider: result.provider,
      sourceLabel: result.sourceLabel,
      fetchedAt: result.fetchedAt,
      warning: result.warning,
      cached: result.cached,
    });
  } catch (error) {
    return errorResponse(error);
  }
}));

async function getRate(
  service: ReturnType<typeof createServiceClient>,
  base: string,
  quote: string,
  provider: string,
  forceRefresh: boolean,
): Promise<{ rate: number; provider: string; sourceLabel: string; fetchedAt: string; warning: string; cached: boolean }> {
  if (!forceRefresh) {
    const { data, error } = await service.from("exchange_rates")
      .select("rate,provider,source_label,fetched_at,expires_at")
      .eq("base_currency", base)
      .eq("quote_currency", quote)
      .eq("provider", provider)
      .maybeSingle();
    if (error && error.code !== "42P01") throw error;
    if (data && Date.parse(data.expires_at) > Date.now()) {
      return {
        rate: Number(data.rate),
        provider: data.provider,
        sourceLabel: data.source_label,
        fetchedAt: data.fetched_at,
        warning: warningForProvider(data.provider),
        cached: true,
      };
    }
  }

  const fetched = provider === "frankfurter"
    ? await fetchFrankfurter(base, quote)
    : await fetchGoogleFinanceReference(base, quote);
  const cacheMinutes = clamp(Number(optionalEnv("FX_RATE_CACHE_MINUTES") ?? "30"), 5, 240);
  const expiresAt = new Date(Date.now() + cacheMinutes * 60_000).toISOString();
  const { error: upsertError } = await service.from("exchange_rates").upsert({
    base_currency: base,
    quote_currency: quote,
    provider: fetched.provider,
    rate: fetched.rate,
    source_label: fetched.sourceLabel,
    fetched_at: fetched.fetchedAt,
    expires_at: expiresAt,
    metadata: { experimental: fetched.provider === GOOGLE_PROVIDER },
  }, { onConflict: "base_currency,quote_currency,provider" });
  if (upsertError && upsertError.code !== "42P01") throw upsertError;
  return { ...fetched, warning: warningForProvider(fetched.provider), cached: false };
}

async function fetchGoogleFinanceReference(base: string, quote: string): Promise<{ rate: number; provider: string; sourceLabel: string; fetchedAt: string }> {
  const direct = await fetchGooglePair(base, quote);
  if (direct) return { rate: direct, provider: GOOGLE_PROVIDER, sourceLabel: "Google Finance", fetchedAt: new Date().toISOString() };
  const inverse = await fetchGooglePair(quote, base);
  if (inverse && inverse > 0) return { rate: 1 / inverse, provider: GOOGLE_PROVIDER, sourceLabel: "Google Finance (par inverso)", fetchedAt: new Date().toISOString() };
  throw new HttpError(502, "google_finance_rate_unavailable");
}

async function fetchGooglePair(base: string, quote: string): Promise<number | null> {
  const url = `https://www.google.com/finance/quote/${encodeURIComponent(base)}-${encodeURIComponent(quote)}`;
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "CapitalFlow-MVP/0.2 (+personal-finance-fx-reference)",
    },
  });
  if (!response.ok) return null;
  const html = await response.text();
  const match = html.match(/data-last-price=["']([0-9]+(?:\.[0-9]+)?)["']/u);
  if (!match?.[1]) return null;
  const rate = Number(match[1]);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

async function fetchFrankfurter(base: string, quote: string): Promise<{ rate: number; provider: string; sourceLabel: string; fetchedAt: string }> {
  const response = await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}&to=${encodeURIComponent(quote)}`);
  if (!response.ok) throw new HttpError(502, "fx_provider_unavailable");
  const payload = await response.json() as { rates?: Record<string, number>; date?: string };
  const rate = payload.rates?.[quote];
  if (!Number.isFinite(rate) || Number(rate) <= 0) throw new HttpError(502, "fx_rate_missing");
  return { rate: Number(rate), provider: "frankfurter", sourceLabel: "Frankfurter / ECB-compatible reference", fetchedAt: new Date().toISOString() };
}

function warningForProvider(provider: string): string {
  if (provider === GOOGLE_PROVIDER) {
    return "Conversión informativa basada en la cotización visible en Google Finance al momento de la consulta. Google indica que algunas cotizaciones pueden retrasarse hasta 20 minutos y que la información es solo de referencia. No equivale a la tasa efectiva de tu banco, tarjeta o casa de cambio; pueden existir spread, comisiones e impuestos.";
  }
  if (provider === "frankfurter") {
    return "Conversión informativa basada en una fuente externa de referencia. No equivale a la tasa efectiva de tu banco, tarjeta o casa de cambio.";
  }
  return "Conversión informativa; la tasa efectiva de una operación puede diferir por spread, comisiones e impuestos.";
}

function convertMinor(amountMinor: number, from: string, to: string, rate: number): number {
  const major = amountMinor / 10 ** exponent(from);
  const converted = Math.round(major * rate * 10 ** exponent(to));
  if (!Number.isSafeInteger(converted)) throw new HttpError(422, "converted_amount_out_of_range");
  return converted;
}

function exponent(currency: string): number {
  return ZERO_DECIMAL.has(currency) ? 0 : 2;
}

function normalizeCurrency(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(422, "currency_required");
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/u.test(normalized)) throw new HttpError(422, "invalid_currency");
  return normalized;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
