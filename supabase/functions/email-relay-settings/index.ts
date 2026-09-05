import { sha256Base64Url } from "../_shared/crypto.ts";
import { withAdditionalCors } from "../_shared/additional-cors.ts";
import { errorResponse, handleOptions, HttpError, json, readJson } from "../_shared/http.ts";
import { assertEntitled, createServiceClient, requireUser } from "../_shared/supabase.ts";
import { requiredEnv } from "../_shared/env.ts";

type SourceProvider="gmail"|"outlook"|"proton"|"other";
function token(): string {
  const bytes=new Uint8Array(32); crypto.getRandomValues(bytes);
  let binary=""; for (const b of bytes) binary+=String.fromCharCode(b);
  return btoa(binary).replace(/\+/gu,"-").replace(/\//gu,"_").replace(/=+$/u,"");
}
function stateName(value: string | null | undefined): "NOT_CONFIGURED"|"VERIFICATION_PENDING"|"ACTIVE"|"ERROR"|"REVOKED" {
  if (!value) return "NOT_CONFIGURED";
  if (value==="active") return "ACTIVE"; if (value==="error") return "ERROR"; if (value==="revoked") return "REVOKED";
  return "VERIFICATION_PENDING";
}
function provider(value:unknown):SourceProvider {
  return value==="gmail"||value==="outlook"||value==="proton"||value==="other"?value:"other";
}
function defaultLabel(value:SourceProvider):string {
  if(value==="gmail") return "Gmail"; if(value==="outlook") return "Outlook / Hotmail"; if(value==="proton") return "Proton Mail"; return "Otro correo";
}

Deno.serve((request)=>withAdditionalCors(request, async()=>{
  const preflight=handleOptions(request); if (preflight) return preflight;
  try {
    if (request.method!=="POST") throw new HttpError(405,"method_not_allowed");
    const {user}=await requireUser(request); const service=createServiceClient();
    const body=await readJson<{action?:string;provider?:SourceProvider;label?:string;sourceId?:string}>(request,20_000);
    const action=body.action ?? "state";
    const domain=requiredEnv("CAPITALFLOW_EMAIL_RELAY_DOMAIN");
    if (action==="generate" || action==="rotate") {
      await assertEntitled(service,user.id);
      const raw=token(); const hash=await sha256Base64Url(raw); const hint=`...${raw.slice(-8)}`;
      const {data,error}=await service.rpc("service_create_or_rotate_email_relay_alias",{p_user_id:user.id,p_token_hash:hash,p_alias_hint:hint}).single();
      if (error) throw error;
      return json({state:"VERIFICATION_PENDING",address:`cf+${raw}@${domain}`,aliasHint:hint,aliasId:data.alias_id,sources:[]});
    }
    if (action==="add_source") {
      await assertEntitled(service,user.id);
      const p=provider(body.provider); const label=(body.label ?? "").trim() || defaultLabel(p);
      if(label.length>80) throw new HttpError(422,"source_label_too_long");
      const {data,error}=await service.rpc("service_create_email_relay_source",{p_user_id:user.id,p_provider:p,p_label:label}).single();
      if(error) throw error;
      return json({source:{id:data.source_id,provider:data.provider,label:data.label,state:stateName(data.status)}});
    }
    if (action==="revoke_source") {
      if(!body.sourceId) throw new HttpError(422,"source_id_required");
      const {data,error}=await service.rpc("service_revoke_email_relay_source",{p_user_id:user.id,p_source_id:body.sourceId});
      if(error) throw error; if(!data) throw new HttpError(404,"source_not_found");
      return json({revoked:true});
    }
    if (action==="revoke") {
      const {error}=await service.rpc("service_revoke_email_relay_alias",{p_user_id:user.id}); if (error) throw error;
      return json({state:"REVOKED",sources:[]});
    }
    const [{data:state,error:stateError},{data:sources,error:sourcesError},{data:catalog,error:catalogError}]=await Promise.all([
      service.rpc("service_get_email_relay_state",{p_user_id:user.id}).maybeSingle(),
      service.rpc("service_list_email_relay_sources",{p_user_id:user.id}),
      service.rpc("service_list_financial_sender_catalog")
    ]);
    if (stateError) throw stateError; if (sourcesError) throw sourcesError; if (catalogError) throw catalogError;
    return json({
      state:stateName(state?.status),aliasHint:state?.alias_hint ?? null,
      lastReceivedAt:state?.last_received_at ?? null,lastFinancialEventAt:state?.last_financial_event_at ?? null,
      domain,
      sources:(sources ?? []).map((s)=>({id:s.source_id,provider:s.provider,label:s.label,state:stateName(s.status),
        gmailConfirmationUrl:s.gmail_confirmation_url ?? null,gmailConfirmationCode:s.gmail_confirmation_code ?? null,
        lastReceivedAt:s.last_received_at ?? null,lastFinancialEventAt:s.last_financial_event_at ?? null})),
      catalog:catalog ?? []
    });
  } catch (error) { return errorResponse(error); }
}));
