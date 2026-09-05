const MAX_RAW_BYTES=524288;
const safe=(value,max=4000)=>typeof value==="string"?value.replace(/[\u0000-\u001f\u007f]+/g," ").replace(/\s+/g," ").trim().slice(0,max):null;
const hex=(buffer)=>[...new Uint8Array(buffer)].map((b)=>b.toString(16).padStart(2,"0")).join("");
export async function sha256Hex(bytes){return hex(await crypto.subtle.digest("SHA-256",bytes));}
export async function sign(secret,timestamp,nonce,body){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return hex(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(`${timestamp}.${nonce}.${body}`)));
}
function bytesToBase64(bytes){let out=""; const step=0x8000; for(let i=0;i<bytes.length;i+=step) out+=String.fromCharCode(...bytes.subarray(i,i+step)); return btoa(out);}
export function detectForwardingProvider(headers){
  const received=(headers.get("received") ?? "").toLowerCase();
  const auth=(headers.get("authentication-results") ?? "").toLowerCase();
  const arc=(headers.get("arc-authentication-results") ?? "").toLowerCase();
  if(headers.has("x-google-smtp-source") || headers.has("x-gm-message-state") || /(?:^|[.\s-])google\.com|gmail\.com/.test(received)) return "gmail";
  if(headers.has("x-ms-exchange-crosstenant-authsource") || headers.has("x-ms-exchange-transport-endtoendlatency") || /protection\.outlook\.com|outlook\.com|office365\.com/.test(received+" "+auth+" "+arc)) return "outlook";
  if(headers.has("x-pm-message-id") || headers.has("x-protonmail-sender") || /protonmail\.(?:com|ch)|proton\.me/.test(received+" "+auth+" "+arc)) return "proton";
  return "other";
}
export async function buildRelayPayload(message){
  if(message.rawSize>MAX_RAW_BYTES) throw new Error("relay_message_too_large");
  const raw=new Uint8Array(await new Response(message.raw).arrayBuffer()); if(raw.byteLength>MAX_RAW_BYTES) throw new Error("relay_message_too_large");
  return {
    recipient:safe(message.to,320),envelopeSender:safe(message.from,320),from:safe(message.headers.get("from"),998),
    messageId:safe(message.headers.get("message-id"),998),date:safe(message.headers.get("date"),998),subject:safe(message.headers.get("subject"),998),
    forwardingProviderHint:detectForwardingProvider(message.headers),
    authentication:{authenticationResults:safe(message.headers.get("authentication-results")),arcAuthenticationResults:safe(message.headers.get("arc-authentication-results")),
      receivedSpf:safe(message.headers.get("received-spf"),2000),arcSeal:safe(message.headers.get("arc-seal"),2000),dkimSignature:safe(message.headers.get("dkim-signature"),2000)},
    receivedAt:new Date().toISOString(),rawSha256:await sha256Hex(raw),rawMimeBase64:bytesToBase64(raw)
  };
}
export default {
  async email(message,env){
    if(message.rawSize>MAX_RAW_BYTES){message.setReject("Message exceeds CapitalFlow relay size limit");return;}
    if(!env.CAPITALFLOW_EMAIL_RELAY_HMAC_SECRET || !env.CAPITALFLOW_EMAIL_RELAY_BACKEND_URL || !env.CAPITALFLOW_EMAIL_RELAY_DOMAIN){message.setReject("CapitalFlow relay is unavailable");return;}
    try{
      const payload=await buildRelayPayload(message);
      if(!payload.recipient?.toLowerCase().endsWith(`@${env.CAPITALFLOW_EMAIL_RELAY_DOMAIN.toLowerCase()}`)){message.setReject("Invalid CapitalFlow relay domain");return;}
      const body=JSON.stringify(payload); const timestamp=String(Math.floor(Date.now()/1000)); const nonce=crypto.randomUUID();
      const signature=await sign(env.CAPITALFLOW_EMAIL_RELAY_HMAC_SECRET,timestamp,nonce,body);
      const response=await fetch(env.CAPITALFLOW_EMAIL_RELAY_BACKEND_URL,{method:"POST",headers:{"content-type":"application/json","x-capitalflow-timestamp":timestamp,"x-capitalflow-nonce":nonce,"x-capitalflow-signature":signature},body});
      if(!response.ok){throw new Error(`backend_status_${response.status}`);}
    }catch(error){console.error(JSON.stringify({event:"capitalflow_email_relay_failure",error_type:error instanceof Error?error.name:"unknown"}));message.setReject("CapitalFlow could not process this message");}
  }
};
