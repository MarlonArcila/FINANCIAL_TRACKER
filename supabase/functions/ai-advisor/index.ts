import { optionalEnv } from "../_shared/env.ts";
import { errorResponse, handleOptions, HttpError, json, readJson } from "../_shared/http.ts";
import { enforceUserRateLimit, RATE_LIMIT_POLICIES } from "../_shared/rate-limit.ts";
import { assertAnnualEntitled, createServiceClient, requireUser } from "../_shared/supabase.ts";

interface AdvisorRequest {
  plan: Record<string, unknown>;
  userPreferences?: { language?: string; tone?: string };
}

Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const { user } = await requireUser(request);
    const service = createServiceClient();
    await assertAnnualEntitled(service, user.id);
    await enforceUserRateLimit(service, user.id, RATE_LIMIT_POLICIES.AI_ADVISOR);
    const body = await readJson<AdvisorRequest>(request, 100_000);
    const plan = validateSafePlan(body.plan);
    const language = body.userPreferences?.language === "en" ? "en" : "es";
    const gatewayUrl = optionalEnv("AI_GATEWAY_URL");
    let explanation: string;
    let provider = "deterministic-template";

    if (gatewayUrl) {
      explanation = await callAiGateway(gatewayUrl, plan, language);
      provider = "configured-ai-gateway";
    } else {
      explanation = fallbackExplanation(plan, language);
    }

    const { error } = await service.from("advisor_runs").insert({
      user_id: user.id,
      engine_version: `ai-explainer-2026-08-12:${provider}`,
      input_snapshot: { language, provider },
      plan_snapshot: plan,
      ai_explanation: explanation,
    });
    if (error) throw error;
    return json({ explanation, provider, numbersChanged: false });
  } catch (error) {
    return errorResponse(error);
  }
});

function validateSafePlan(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new HttpError(422, "plan_required");
  const serialized = JSON.stringify(value);
  if (serialized.length > 75_000) throw new HttpError(413, "plan_too_large");
  const forbidden = /(?:email|sender|subject|messageBody|notificationText|accountNumber|accessToken|refreshToken)/iu;
  if (Object.keys(flattenKeys(value)).some((key) => forbidden.test(key))) {
    throw new HttpError(422, "plan_contains_forbidden_raw_data");
  }
  const currency = value.currency;
  const allocations = value.allocations;
  const available = value.availableMinor;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/u.test(currency)) throw new HttpError(422, "invalid_plan_currency");
  if (!Number.isSafeInteger(available) || Number(available) < 0) throw new HttpError(422, "invalid_plan_available");
  if (!Array.isArray(allocations) || allocations.length > 100) throw new HttpError(422, "invalid_plan_allocations");
  let sum = 0;
  for (const item of allocations) {
    if (!isRecord(item) || !Number.isSafeInteger(item.amountMinor) || Number(item.amountMinor) < 0) {
      throw new HttpError(422, "invalid_allocation");
    }
    sum += Number(item.amountMinor);
  }
  if (!Number.isSafeInteger(sum) || sum > Number(available)) throw new HttpError(422, "allocation_sum_exceeds_available");
  return structuredClone(value);
}

async function callAiGateway(url: string, plan: Record<string, unknown>, language: "es" | "en"): Promise<string> {
  const apiKey = optionalEnv("AI_GATEWAY_KEY");
  const model = optionalEnv("AI_MODEL") ?? "default";
  const system = language === "es"
    ? "Explica un plan financiero educativo en español claro. No cambies cifras, no prometas rentabilidad, no recomiendes productos concretos y menciona riesgo, horizonte, liquidez e interés compuesto. Máximo 350 palabras."
    : "Explain an educational financial allocation plan in clear English. Do not change numbers, promise returns, or recommend named products. Discuss risk, horizon, liquidity, and compounding. Maximum 350 words.";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `PLAN_JSON\n${JSON.stringify(plan)}` },
      ],
    }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new HttpError(502, "ai_gateway_error");
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = isRecord(choices[0]) ? choices[0] : null;
  const message = first && isRecord(first.message) ? first.message : null;
  const content = typeof message?.content === "string"
    ? message.content
    : typeof payload.output_text === "string" ? payload.output_text : null;
  if (!content) throw new HttpError(502, "ai_gateway_empty_response");
  return content.trim().slice(0, 5_000);
}

function fallbackExplanation(plan: Record<string, unknown>, language: "es" | "en"): string {
  const deterministic = typeof plan.deterministicExplanation === "string" ? plan.deterministicExplanation : "";
  const warnings = Array.isArray(plan.warnings) ? plan.warnings.filter((item): item is string => typeof item === "string") : [];
  if (language === "en") {
    return `${deterministic} This explanation was generated by the non-AI fallback because no AI gateway is configured. Keep short-term money liquid, review risk against the selected horizon, and treat all projected compound growth as illustrative rather than guaranteed.${warnings.length ? ` Warnings: ${warnings.join(" ")}` : ""}`.trim();
  }
  return `${deterministic} Esta explicación fue generada por la alternativa sin IA porque no hay un proveedor de IA configurado. Mantén líquido el dinero de corto plazo, contrasta el riesgo con el horizonte elegido y considera toda proyección compuesta como ilustrativa, no garantizada.${warnings.length ? ` Advertencias: ${warnings.join(" ")}` : ""}`.trim();
}

function flattenKeys(value: unknown, prefix = ""): Record<string, true> {
  const result: Record<string, true> = {};
  if (Array.isArray(value)) {
    value.forEach((item, index) => Object.assign(result, flattenKeys(item, `${prefix}[${index}]`)));
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      result[path] = true;
      Object.assign(result, flattenKeys(item, path));
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
