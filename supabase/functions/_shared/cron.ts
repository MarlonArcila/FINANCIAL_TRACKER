import { optionalEnv, requiredEnv } from "./env.ts";
import { HttpError } from "./http.ts";

/** Constant-time-enough comparison for high-entropy deployment secrets. */
export function requireCronSecret(request: Request, expected = requiredEnv("CRON_SECRET")): void {
  const supplied = request.headers.get("x-cron-secret") ?? "";
  if (!sameLengthConstantTime(supplied, expected)) throw new HttpError(401, "invalid_cron_secret");
}

// Flags are checked only after the cron secret so configuration is not disclosed.
export function isWorkerEnabled(value: string | null): boolean { return value?.toLowerCase() === "true"; }
export function requireWorkerEnabled(name: "MAIL_SYNC_WORKER_ENABLED" | "MAIL_WATCH_RENEWAL_ENABLED" | "CLOUD_BACKUP_WORKER_ENABLED"): void {
  if (!isWorkerEnabled(optionalEnv(name))) throw new HttpError(503, "worker_disabled");
}

function sameLengthConstantTime(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
