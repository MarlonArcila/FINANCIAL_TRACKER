import { sha256Base64Url } from "../_shared/crypto.ts";
import { requiredEnv } from "../_shared/env.ts";
import { parseMailMessage } from "../_shared/financial-parser.ts";
import { decodeBase64Bytes, detectGmailForwardingConfirmation, EMAIL_RELAY_MAX_RAW_BYTES, extractAliasToken, extractTextFromMime, sanitizeRelayHeader, sha256Hex, verifyRelaySignature } from "../_shared/email-relay.ts";
import { errorResponse, HttpError, json } from "../_shared/http.ts";
import { ingestCandidate } from "../_shared/ingestion.ts";
import { assertEntitled, createServiceClient } from "../_shared/supabase.ts";

type SourceProvider="gmail"|"outlook"|"proton"|"other";
type RelayPayload={recipient?:unknown;envelopeSender?:unknown;from?:unknown;messageId?:unknown;date?:unknown;subject?:unknown;receivedAt?:unknown;rawSha256?:unknown;rawMimeBase64?:unknown;authentication?:unknown;forwardingProviderHint?:unknown};
type RelayAliasRow={alias_id:string;user_id:string;connection_id:string};
type RelaySourceMatchRow={source_id:string|null;match_status:string};
function record(value:unknown):Record<string,unknown>{return value && typeof value==="object" && !Array.isArray(value)?value as Record<string,unknown>:{};}
function relayAliasRow(value:unknown):RelayAliasRow {
  const row=record(value);
  if(typeof row.alias_id!=="string"||typeof row.user_id!=="string"||typeof row.connection_id!=="string") throw new HttpError(500,"relay_alias_contract_invalid");
  return {alias_id:row.alias_id,user_id:row.user_id,connection_id:row.connection_id};
}
function relaySourceMatchRow(value:unknown):RelaySourceMatchRow {
  const row=record(value);
  const sourceId=typeof row.source_id==="string"?row.source_id:null;
  const matchStatus=typeof row.match_status==="string"?row.match_status:"unknown";
  return {source_id:sourceId,match_status:matchStatus};
}
function providerHint(value:unknown):SourceProvider{return value==="gmail"||value==="outlook"||value==="proton"||value==="other"?value:"other";}

Deno.serve(async(request)=>{
  try {
    if (request.method!=="POST") throw new HttpError(405,"method_not_allowed");
    const length=Number(request.headers.get("content-length") ?? "0"); if (Number.isFinite(length) && length>800_000) throw new HttpError(413,"request_too_large");
    const rawBody=await request.text(); if (new TextEncoder().encode(rawBody).length>800_000) throw new HttpError(413,"request_too_large");
    const timestamp=request.headers.get("x-capitalflow-timestamp") ?? "";
    const nonce=request.headers.get("x-capitalflow-nonce") ?? "";
    const signature=request.headers.get("x-capitalflow-signature") ?? "";
    await verifyRelaySignature({secret:requiredEnv("CAPITALFLOW_EMAIL_RELAY_HMAC_SECRET"),timestamp,nonce,signature,body:rawBody});
    const service=createServiceClient();
    const nonceHash=await sha256Base64Url(nonce);
    const expiresAt=new Date((Number(timestamp)+600)*1000).toISOString();
    const {data:claimed,error:claimError}=await service.rpc("service_claim_email_relay_replay",{p_nonce_hash:nonceHash,p_expires_at:expiresAt});
    if (claimError) throw claimError; if (!claimed) throw new HttpError(409,"relay_replay_detected");

    let body:RelayPayload; try { body=JSON.parse(rawBody) as RelayPayload; } catch { throw new HttpError(400,"invalid_json"); }
    const recipient=sanitizeRelayHeader(body.recipient,320); if (!recipient) throw new HttpError(422,"missing_recipient");
    const domain=requiredEnv("CAPITALFLOW_EMAIL_RELAY_DOMAIN"); const rawToken=extractAliasToken(recipient,domain); const tokenHash=await sha256Base64Url(rawToken);
    const {data:aliasData,error:aliasError}=await service.rpc("service_resolve_email_relay_alias",{p_token_hash:tokenHash}).maybeSingle();
    if (aliasError) throw aliasError; if (!aliasData) throw new HttpError(404,"relay_alias_not_found");
    const alias=relayAliasRow(aliasData);
    const sourceProvider=providerHint(body.forwardingProviderHint);
    const {data:sourceMatchData,error:sourceMatchError}=await service.rpc("service_match_email_relay_source",{p_alias_id:alias.alias_id,p_provider:sourceProvider}).single();
    if(sourceMatchError) throw sourceMatchError;
    const sourceMatch=relaySourceMatchRow(sourceMatchData);
    let sourceId:string|null=sourceMatch.source_id;
    const {data:allowed,error:rateError}=await service.rpc("service_take_email_relay_rate_limit",{p_alias_id:alias.alias_id,p_limit:30,p_window_seconds:600});
    if (rateError) throw rateError; if (!allowed) throw new HttpError(429,"relay_rate_limited");

    const rawMime=typeof body.rawMimeBase64==="string" ? body.rawMimeBase64 : "";
    if (!rawMime || rawMime.length>740_000) throw new HttpError(413,"relay_message_too_large");
    const rawBytes=decodeBase64Bytes(rawMime); if (rawBytes.byteLength>EMAIL_RELAY_MAX_RAW_BYTES) throw new HttpError(413,"relay_message_too_large");
    const computedHash=await sha256Hex(rawBytes); if (typeof body.rawSha256!=="string" || body.rawSha256.toLowerCase()!==computedHash) throw new HttpError(422,"relay_raw_hash_mismatch");
    const messageId=sanitizeRelayHeader(body.messageId,998); const envelopeSender=sanitizeRelayHeader(body.envelopeSender,320);
    const from=sanitizeRelayHeader(body.from,998); const subject=sanitizeRelayHeader(body.subject,998);
    const receivedAt=typeof body.receivedAt==="string" && !Number.isNaN(Date.parse(body.receivedAt)) ? new Date(body.receivedAt).toISOString() : new Date().toISOString();
    const occurredAt=typeof body.date==="string" && !Number.isNaN(Date.parse(body.date)) ? new Date(body.date).toISOString() : receivedAt;
    const rawText=new TextDecoder("utf-8",{fatal:false}).decode(rawBytes); const text=extractTextFromMime(rawText);
    const fingerprint=await sha256Base64Url(`email_relay|${alias.alias_id}|${messageId ?? ""}|${computedHash}`);
    const auth=record(body.authentication);
    const metadata={
      relay_version:"email-relay-v2-multi-source",forwarding_provider_hint:sourceProvider,source_match_status:sourceMatch?.match_status ?? "unknown",envelope_sender:envelopeSender,
      authentication_results:sanitizeRelayHeader(auth.authenticationResults,4000),arc_authentication_results:sanitizeRelayHeader(auth.arcAuthenticationResults,4000),
      received_spf:sanitizeRelayHeader(auth.receivedSpf,2000),arc_seal:sanitizeRelayHeader(auth.arcSeal,2000),dkim_signature_present:Boolean(sanitizeRelayHeader(auth.dkimSignature,2000))
    };
    const sourcePayload={user_id:alias.user_id,connection_id:alias.connection_id,provider:"email_relay",external_id:messageId,occurred_at:occurredAt,
      sender_normalized:from ?? envelopeSender,title_sanitized:subject,text_sanitized:text.slice(0,100_000),fingerprint,metadata,processing_status:"received",
      recipient_alias_id:alias.alias_id,recipient_source_id:sourceId,forwarding_provider_hint:sourceProvider,message_id:messageId,received_at:receivedAt,raw_sha256:computedHash};
    const {data:source,error:sourceError}=await service.from("source_events").insert(sourcePayload).select("id").single();
    if (sourceError) {
      if (sourceError.code==="23505") return json({accepted:true,duplicate:true},202);
      throw sourceError;
    }

    if(sourceMatch?.match_status==="revoked") {
      await service.from("source_events").update({processing_status:"ignored",processing_error:"relay_source_revoked",metadata:{...metadata,event_type:"relay_source_revoked"}}).eq("id",source.id);
      return json({accepted:true,financial:false,source:"revoked"},202);
    }

    const verification=detectGmailForwardingConfirmation(subject,text);
    if (verification) {
      const {data:gmailMatchData,error:gmailMatchError}=await service.rpc("service_match_email_relay_source",{p_alias_id:alias.alias_id,p_provider:"gmail"}).single();
      if(gmailMatchError) throw gmailMatchError;
      const gmailMatch=relaySourceMatchRow(gmailMatchData);
      sourceId=gmailMatch.source_id ?? (sourceProvider==="gmail"?sourceId:null);
      await service.from("source_events").update({processing_status:"ignored",processing_error:null,recipient_source_id:sourceId,forwarding_provider_hint:"gmail",metadata:{...metadata,event_type:"gmail_forwarding_confirmation",forwarding_provider_hint:"gmail",source_match_status:gmailMatch?.match_status ?? "unknown"}}).eq("id",source.id);
      const {error}=await service.rpc("service_update_email_relay_state",{p_alias_id:alias.alias_id,p_source_id:sourceId,p_provider_hint:"gmail",p_status:"pending",p_financial:false,p_gmail_url:verification.url,p_gmail_code:verification.code}); if (error) throw error;
      return json({accepted:true,verification:"gmail_forwarding",financial:false},202);
    }

    try { await assertEntitled(service,alias.user_id); } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 402) throw error;
      await service.from("source_events").update({processing_status:"ignored",processing_error:"subscription_inactive"}).eq("id",source.id);
      await service.rpc("service_update_email_relay_state",{p_alias_id:alias.alias_id,p_source_id:sourceId,p_provider_hint:sourceProvider,p_status:"active",p_financial:false,p_gmail_url:null,p_gmail_code:null});
      return json({accepted:true,financial:false,entitlement:"inactive"},202);
    }

    const {data:profile,error:profileError}=await service.from("profiles").select("base_currency").eq("id",alias.user_id).single(); if (profileError) throw profileError;
    const parsed=await parseMailMessage({provider:"email_relay",externalId:messageId ?? fingerprint,occurredAt,sender:from ?? envelopeSender,title:subject,text,defaultCurrency:profile.base_currency});
    if (!parsed) {
      await service.from("source_events").update({processing_status:"ignored",metadata:{...metadata,event_type:"non_financial"}}).eq("id",source.id);
      await service.rpc("service_update_email_relay_state",{p_alias_id:alias.alias_id,p_source_id:sourceId,p_provider_hint:sourceProvider,p_status:"active",p_financial:false,p_gmail_url:null,p_gmail_code:null});
      return json({accepted:true,financial:false},202);
    }
    parsed.fingerprint=fingerprint;
    const result=await ingestCandidate(service,alias.user_id,parsed,alias.connection_id,{aliasId:alias.alias_id,sourceId,providerHint:sourceProvider});
    await service.from("source_events").update({
      recipient_alias_id:alias.alias_id,recipient_source_id:sourceId,forwarding_provider_hint:sourceProvider,message_id:messageId,received_at:receivedAt,raw_sha256:computedHash,
      parser_version:parsed.parserVersion,parser_rule_version:parsed.parserVersion,detected_amount_minor:parsed.amountMinor,detected_currency:parsed.currency,
      detected_direction:parsed.proposedKind,detected_merchant:parsed.merchant,detected_confidence:parsed.confidence,
      candidate_id:result.candidateId,transaction_id:result.automation?.transactionId ?? null,processing_status:"parsed",
      metadata:{...metadata,parser_version:parsed.parserVersion,automation_outcome:result.automation?.outcome ?? null}
    }).eq("id",source.id);
    await service.rpc("service_update_email_relay_state",{p_alias_id:alias.alias_id,p_source_id:sourceId,p_provider_hint:sourceProvider,p_status:"active",p_financial:true,p_gmail_url:null,p_gmail_code:null});
    return json({accepted:true,financial:true,duplicate:result.duplicate,candidateCreated:result.inserted,automation:result.automation?.outcome ?? null},202);
  } catch(error) { return errorResponse(error); }
});
