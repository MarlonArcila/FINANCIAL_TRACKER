import fs from "node:fs";
import path from "node:path";
import { firstEnv } from "./pilot-lib.mjs";

const approved = firstEnv("CF_LEGAL_APPROVED");
const approvedBy = firstEnv("CF_LEGAL_APPROVED_BY");
const approvedDate = firstEnv("CF_LEGAL_APPROVED_DATE");
const privacyUrl = firstEnv("CF_PRIVACY_URL");
const termsUrl = firstEnv("CF_TERMS_URL");
if (approved !== "true" || !approvedBy || !approvedDate) throw new Error("LEGAL_HUMAN_APPROVAL_ATTESTATION_REQUIRED");
if (!/^\d{4}-\d{2}-\d{2}$/u.test(approvedDate)) throw new Error("CF_LEGAL_APPROVED_DATE_MUST_BE_YYYY_MM_DD");
if (!privacyUrl || !termsUrl) throw new Error("CF_PRIVACY_URL_AND_CF_TERMS_URL_REQUIRED");

async function verifyDocument(label, rawUrl, keywords) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${label}_URL_MUST_BE_PUBLIC_HTTPS`);
  const response = await fetch(url, { redirect: "follow", headers: { "cache-control": "no-cache" } });
  if (!response.ok) throw new Error(`${label}_HTTP_${response.status}`);
  const text = (await response.text()).toLowerCase();
  if (text.length < 500) throw new Error(`${label}_CONTENT_TOO_SHORT`);
  for (const keyword of keywords) if (!text.includes(keyword)) throw new Error(`${label}_MISSING_${keyword}`);
  return url.toString();
}

const verifiedPrivacy = await verifyDocument("PRIVACY", privacyUrl, ["priv", "datos"]);
const termsProbe = await verifyDocument("TERMS", termsUrl, ["servicio"]);
const termsResponse = await fetch(termsProbe, { headers: { "cache-control": "no-cache" } });
const termsText = (await termsResponse.text()).toLowerCase();
if (!termsText.includes("términ") && !termsText.includes("termin")) throw new Error("TERMS_MISSING_TERMS_LANGUAGE");
const verifiedTerms = termsProbe;
fs.mkdirSync("artifacts", { recursive: true });
const evidence = {
  approved: true,
  approvedBy,
  approvedDate,
  privacyUrl: verifiedPrivacy,
  termsUrl: verifiedTerms,
  verifiedAt: new Date().toISOString(),
};
const out = path.join("artifacts", `pilot-legal-privacy-${Date.now()}.json`);
fs.writeFileSync(out, JSON.stringify(evidence, null, 2) + "\n");
console.log(`LEGAL_PRIVACY_EVIDENCE=${out}`);
console.log("LEGAL_PRIVACY_REVIEW=GREEN");
