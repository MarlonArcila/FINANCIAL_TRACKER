import { validateDeviceCandidate } from "../_shared/financial-parser.ts";
import { errorResponse, handleOptions, HttpError, json, readJson } from "../_shared/http.ts";
import { withAdditionalCors } from "../_shared/additional-cors.ts";
import { ingestCandidate } from "../_shared/ingestion.ts";
import { assertEntitled, createServiceClient, requireUser } from "../_shared/supabase.ts";

Deno.serve((request) => withAdditionalCors(request, async () => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const { user } = await requireUser(request);
    const service = createServiceClient();
    await assertEntitled(service, user.id);
    const body = await readJson<{ candidates?: unknown[] }>(request, 250_000);
    if (!Array.isArray(body.candidates) || body.candidates.length > 100) throw new HttpError(422, "invalid_candidates_batch");

    let inserted = 0;
    let duplicates = 0;
    let autoPosted = 0;
    let needsReview = 0;
    let autoIgnored = 0;
    const acknowledgedLocalIds: string[] = [];
    const rejectedLocalIds: string[] = [];
    for (const raw of body.candidates) {
      const candidate = await validateDeviceCandidate(raw);
      const localId = raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).localId === "string"
        ? (raw as Record<string, unknown>).localId as string
        : null;
      if (!candidate) {
        if (localId) rejectedLocalIds.push(localId);
        continue;
      }
      const result = await ingestCandidate(service, user.id, candidate);
      if (result.inserted) inserted += 1;
      if (result.duplicate) duplicates += 1;
      if (result.automation?.outcome === "auto_posted") autoPosted += 1;
      if (result.automation?.outcome === "needs_review") needsReview += 1;
      if (result.automation?.outcome === "auto_ignored") autoIgnored += 1;
      acknowledgedLocalIds.push(candidate.localId);
    }
    return json({ inserted, duplicates, autoPosted, needsReview, autoIgnored, acknowledgedLocalIds, rejectedLocalIds });
  } catch (error) {
    return errorResponse(error);
  }
}));
