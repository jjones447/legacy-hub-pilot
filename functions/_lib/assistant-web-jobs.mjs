// [pc2-codex-42] Default-OFF private website jobs; the machine never confirms or writes targets.
import {confirmationActor,ownsDraft} from './agent-confirmation.mjs';
import {onRequestPost as agentPost} from '../api/agent/[[path]].js';
import {exact,canonical,sha,random128,rawKey,signPointer,hmacVerify,machineSigningInput,boundedBody,assertPerimeter} from './web-job-protocol.mjs';

export const TARGETS=Object.freeze({content:'ps_home.hero',forms:'ps_form.request_support',caregiver:'cg_d7_synthetic_13',event:'ev_d7_synthetic_13',grant:'1'});
const FIELDS=Object.freeze({content:['title'],forms:['name_label'],caregiver:['segment_tags'],event:['title'],grant:['review_notes']});
const ORIGIN='https://legacy-hub-d7-acceptance.pages.dev';
const content=a=>a==='content'||a==='forms';
const id=v=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(v);
const reply=(b,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'content-type':'application/json','cache-control':'no-store','referrer-policy':'no-referrer'}});
const refused=(s=403)=>reply({ok:false,error:'web_job_refused'},s);
const held=()=>reply({ok:false,state:'hold',error:'web_job_hold'},409);
// Closed response metadata ONLY for the verified active staff create perimeter.
// No raw exception/provider object is serialized or sent to a logging sink.
const CREATE_STAGES=new Set(['request','lookup','actor_busy','transport','snapshot','freeze','persist','reserve','send','send_receipt','ack','final_read']);
const POINTER_STAGES=new Set(['send','response_body','response_rejected','response_receipt']);
const SLACK_ERRORS=new Set(['not_in_channel','channel_not_found','invalid_auth','not_authed','token_revoked','token_expired','account_inactive','missing_scope','no_permission','is_archived','restricted_action','ratelimited','rate_limited','service_unavailable']);
const httpStatus=value=>Number.isInteger(value)&&value>=100&&value<=599;
class PointerFailure extends Error{
  constructor(stage,status,code){super('web_job_pointer_hold');this.stage=stage;if(httpStatus(status))this.status=status;if(SLACK_ERRORS.has(code))this.code=code;}
}
function createHeld(authorized,stage,error){
  if(!authorized||!CREATE_STAGES.has(stage))return held();
  const diagnostic={diagnostic_stage:stage};
  if(error instanceof PointerFailure&&POINTER_STAGES.has(error.stage)){
    diagnostic.diagnostic_stage=error.stage;
    if(httpStatus(error.status))diagnostic.diagnostic_http_status=error.status;
    if(SLACK_ERRORS.has(error.code))diagnostic.diagnostic_slack_error=error.code;
  }
  return reply({ok:false,state:'hold',error:'web_job_hold',...diagnostic},409);
}
const get=(db,j)=>db.prepare('SELECT * FROM assistant_web_job WHERE id = ?').bind(j).first();
export const enabled=env=>env.ASSISTANT_WEB_JOBS_ENABLED==='1';
function configuration(env,origin){
  if(!enabled(env)||env.ENVIRONMENT!=='preview'||origin!==ORIGIN||env.ASSISTANT_APP_ORIGIN!==origin||!env.LEGACY_DB)throw Error('config');
  const perimeter={origin,workspace_id:env.ASSISTANT_WORKSPACE,channel_id:env.ASSISTANT_CHANNEL,app_id:env.ASSISTANT_WEB_JOB_APP_ID,seat_id:env.ASSISTANT_WEB_JOB_SEAT_ID};
  assertPerimeter(perimeter);return perimeter;
}
async function frozenFor(row,perimeter){
  if(typeof row.frozen_json!=='string'||new TextEncoder().encode(row.frozen_json).length>12000||await sha(row.frozen_json)!==row.input_digest)throw Error('frozen');
  const frozen=JSON.parse(row.frozen_json);
  if(frozen.job_id!==row.id||frozen.nonce!==row.pointer_nonce||frozen.actor!==row.actor||frozen.origin!==row.app_origin||canonical(frozen.perimeter)!==canonical(perimeter)||!Object.hasOwn(TARGETS,frozen.area)||frozen.target_id!==TARGETS[frozen.area])throw Error('frozen');
  return frozen;
}
async function actorFor(context){
  const actor=confirmationActor(context.data);if(!actor)return null;
  const staff=await context.env.LEGACY_DB.prepare('SELECT email,status FROM staff_member WHERE email = ?').bind(actor).first();
  return staff?.status==='active'&&staff.email===actor?actor:null;
}
async function snapshot(db,area){
  if(!Object.hasOwn(TARGETS,area))throw Error('target');
  const table=content(area)?'content_item':({caregiver:'caregiver',event:'event',grant:'grant_application'})[area];
  const row=await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(TARGETS[area]).first();
  if(!row||content(area)&&(row.status!=='published'||row.type_id!=='page_section'))throw Error('target');
  const data=content(area)?JSON.parse(row.data):row;
  if(content(area)&&data.section_key!==(area==='content'?'home.hero':'form.request_support'))throw Error('target');
  const schema=content(area)?await db.prepare('SELECT id,json_schema FROM content_type WHERE id = ?').bind('page_section').first():null;
  if(content(area)&&!schema)throw Error('schema');
  const linked=area==='grant'?await db.prepare('SELECT * FROM award WHERE grant_application_id = ?').bind('1').first():null;
  const current=Object.fromEntries([...FIELDS[area],...(content(area)?['section_key']:area==='grant'?['status']:[])].filter(k=>Object.hasOwn(data,k)).map(k=>[k,data[k]]));
  const parsed=schema?JSON.parse(schema.json_schema):null;
  const modelSchema=parsed?.oneOf?parsed.oneOf.find(b=>b.properties?.section_key?.const===data.section_key):parsed;
  return {revision:await sha(canonical({row,schema,linked})),current,schema:modelSchema,guard:{table,row,schema,linked}};
}
function draftGuard(db,job,fresh,now){
  const args=[];
  const exists=(table,record)=>{
    const fields=Object.keys(record);if(!fields.every(k=>/^[a-z_][a-z0-9_]*$/.test(k)))throw Error('snapshot');
    args.push(...fields.map(k=>record[k]));
    return `EXISTS(SELECT 1 FROM ${table} WHERE ${fields.map(k=>`"${k}" IS ?`).join(' AND ')})`;
  };
  const predicates=[exists(fresh.guard.table,fresh.guard.row)];
  if(fresh.guard.schema)predicates.push(exists('content_type',fresh.guard.schema));
  if(fresh.guard.table==='grant_application'){
    if(fresh.guard.linked)predicates.push(exists('award',fresh.guard.linked));
    else{predicates.push('NOT EXISTS(SELECT 1 FROM award WHERE grant_application_id=?)');args.push('1');}
  }
  predicates.push("EXISTS(SELECT 1 FROM assistant_web_job WHERE id=? AND actor=? AND state='materializing' AND input_digest=?)");args.push(job.id,job.actor,job.input_digest);
  // Same D1 transaction as original draft INSERT. NOT NULL aborts on drift; unique guard
  // also prevents a second insertion after a lost acknowledgement. This is NOT an audit.
  return db.prepare(`INSERT INTO assistant_web_job_nonce(nonce,received_at) VALUES(?,CASE WHEN ${predicates.join(' AND ')} THEN ? ELSE NULL END)`).bind('materialize:'+job.id,...args,now);
}
const view=row=>({ok:true,job_id:row.id,state:row.state});
async function hold(db,j){await db.prepare("UPDATE assistant_web_job SET state='hold' WHERE id=? AND state IN ('pending','claimed','result','materializing')").bind(j).run();}
async function cas(db,j,from,to,values={}){
  const keys=Object.keys(values); // Only server literal column names, never wire-provided.
  return db.prepare(`UPDATE assistant_web_job SET state=?${keys.map(k=>`,${k}=?`).join('')} WHERE id=? AND state=? RETURNING *`).bind(to,...keys.map(k=>values[k]),j,from).first();
}

/** Injection boundary: token and fetch are supplied by the approved backend custodian, never a browser. */
export function slackPointerTransport({token,fetchImpl}){
  if(typeof token!=='string'||!token.startsWith('xoxb-')||typeof fetchImpl!=='function')throw Error('transport');
  return async ({channel,text})=>{
    let response;
    try{response=await fetchImpl('https://slack.com/api/chat.postMessage',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({channel,text,unfurl_links:false,unfurl_media:false})});}
    catch{throw new PointerFailure('send');} // A timeout/unknown post is never retried.
    let body;
    try{body=JSON.parse(await boundedBody(response,4096));}
    catch{throw new PointerFailure('response_body',response.status);}
    if(!response.ok||body?.ok!==true)throw new PointerFailure('response_rejected',response.status,body?.ok===false?body.error:undefined);
    if(body.channel!==channel||typeof body.ts!=='string'||!/^[0-9]+\.[0-9]+$/.test(body.ts))throw new PointerFailure('response_receipt',response.status);
    return {channel,ts:body.ts}; // No raw provider errors or message content escape.
  };
}

export async function createWebJob(context,now=Math.floor(Date.now()/1000)){
  let jobId,diagnosticsAllowed=false,stage='request';const {request,env}=context;
  try{
    const url=new URL(request.url),perimeter=configuration(env,url.origin),actor=await actorFor(context);
    if(!actor||request.method!=='POST'||request.headers.get('origin')!==url.origin||url.search)return refused();
    diagnosticsAllowed=true; // configuration() already required feature ON; actorFor verified active staff.
    const body=JSON.parse(await boundedBody(request));
    const isContent=url.pathname==='/api/agent/draft',isWorkflow=url.pathname==='/api/agent/change/draft';
    if(!isContent&&!isWorkflow)return refused();
    if(!exact(body,isContent?['type_id','target_id','request','idempotency_key']:['area','target_id','request','idempotency_key'])||!id(body.idempotency_key)||typeof body.request!=='string'||!body.request.trim()||body.request.length>4000)return refused(400);
    const area=isContent?(body.target_id===TARGETS.forms?'forms':'content'):body.area;
    if(!Object.hasOwn(TARGETS,area)||body.target_id!==TARGETS[area]||isContent&&body.type_id!=='page_section'||isWorkflow&&content(area))return refused();
    stage='lookup';const prior=await env.LEGACY_DB.prepare('SELECT * FROM assistant_web_job WHERE actor = ? AND idempotency_key = ?').bind(actor,body.idempotency_key).first();
    if(prior){const frozen=JSON.parse(prior.frozen_json);return frozen.request===body.request&&frozen.area===area&&prior.app_origin===url.origin?reply(view(prior)):held();}
    // Match the unchanged actor-global one-active index, including expired HOLD.
    // This read is advisory: the index remains the race backstop before any send.
    stage='actor_busy';
    const active=await env.LEGACY_DB.prepare("SELECT id FROM assistant_web_job WHERE actor = ? AND state IN ('pending','claimed','result','materializing','hold') LIMIT 1").bind(actor).first();
    if(active)return reply({ok:false,state:'hold',error:'web_job_hold',diagnostic_stage:'actor_busy',refusal:'A previous assistant request is unresolved. This request was not created or sent. Do not retry; ask the operator to resolve the existing hold.'},409);
    // Default-OFF composition: tests inject transport; a future approved backend may bind
    // the SAME existing bot token here. No secret lookup/mint/placement occurs in this source task.
    stage='transport';const sendPointer=typeof env.ASSISTANT_WEB_JOB_TRANSPORT==='function'?env.ASSISTANT_WEB_JOB_TRANSPORT:
      typeof env.ASSISTANT_WEB_JOB_SLACK_BOT_TOKEN==='string'?slackPointerTransport({token:env.ASSISTANT_WEB_JOB_SLACK_BOT_TOKEN,fetchImpl:fetch}):null;
    if(!sendPointer)return refused(503); // Unqualified custody/placement never falls back to Cloudflare AI.
    stage='snapshot';const key=rawKey(env.ASSISTANT_WEB_JOB_KEY_HEX),target=await snapshot(env.LEGACY_DB,area);
    jobId=random128();const nonce=random128();
    const frozen={v:1,job_id:jobId,nonce,actor,origin:url.origin,perimeter,area,target_id:TARGETS[area],request:body.request,current:target.current,schema:target.schema,revision:target.revision,allowed_fields:FIELDS[area],created_at:now};
    stage='freeze';const raw=canonical(frozen);if(new TextEncoder().encode(raw).length>12000)return refused(413);
    const inputDigest=await sha(raw);
    const wire=await signPointer({protocol:'legacy_web_job_v1',purpose:'slack_pointer',...perimeter,job_id:jobId,input_digest:inputDigest,nonce,issued_at:now,expires_at:now+60},key,perimeter,now);
    stage='persist';await env.LEGACY_DB.prepare("INSERT INTO assistant_web_job(id,actor,idempotency_key,input_digest,pointer_nonce,app_origin,frozen_json,state,dispatch_state,pointer_expires_at,expires_at,created_at) VALUES(?,?,?,?,?,?,?,'pending','new',?,?,?)").bind(jobId,actor,body.idempotency_key,inputDigest,nonce,url.origin,raw,now+60,now+240,now).run();
    stage='reserve';const reservation=await env.LEGACY_DB.prepare("UPDATE assistant_web_job SET dispatch_state='reserved' WHERE id=? AND state='pending' AND dispatch_state='new' RETURNING id").bind(jobId).first();
    if(!reservation)return createHeld(diagnosticsAllowed,stage);
    try{
      stage='send';const sent=await sendPointer({channel:perimeter.channel_id,text:wire});
      stage='send_receipt';
      if(!exact(sent,['channel','ts'])||sent.channel!==perimeter.channel_id||typeof sent.ts!=='string'||!/^[0-9]+\.[0-9]+$/.test(sent.ts))throw Error('send');
      // A machine may claim/result before this acknowledgement; never reset its job state.
      stage='ack';const acknowledged=await env.LEGACY_DB.prepare("UPDATE assistant_web_job SET dispatch_state='sent',dispatch_ts=? WHERE id=? AND dispatch_state='reserved' AND (claim_slack_ts IS NULL OR claim_slack_ts=?) RETURNING id").bind(sent.ts,jobId,sent.ts).first();
      if(!acknowledged)throw Error('receipt');
    }catch(error){await hold(env.LEGACY_DB,jobId);return createHeld(diagnosticsAllowed,stage,error);}
    stage='final_read';return reply(view(await get(env.LEGACY_DB,jobId)),202);
  }catch(error){if(jobId){try{await hold(env.LEGACY_DB,jobId);}catch{ /* Durable intermediate state prevents replay; no provider retry. */ }}return createHeld(diagnosticsAllowed,stage,error);}
}

const CLAIM=['job_id','input_digest','pointer_nonce','invocation_id','attempt_id','source_id','config_id','generation_id','slack_event_id','slack_ts'];
const RESULT=['job_id','input_digest','lease_token','invocation_id','attempt_id','source_id','config_id','generation_id','status','proposal','result_digest'];
const BINDING=['invocation_id','attempt_id','source_id','config_id','generation_id'];
function validProposal(area,p){
  if(!exact(p,['operation','payload'])||p.operation!==(area==='grant'?'review':'update')||!exact(p.payload,FIELDS[area]))return false;
  const v=p.payload[FIELDS[area][0]];
  return area==='caregiver'?Array.isArray(v)&&v.length<=12&&v.every(t=>typeof t==='string'&&t.length>0&&t.length<=80):typeof v==='string'&&v.trim().length>0&&v.length<=(area==='content'||area==='event'?200:2000);
}
export async function machineWebJob(context,now=Math.floor(Date.now()/1000)){
  const {request,env}=context;let row;
  try{
    const url=new URL(request.url),perimeter=configuration(env,url.origin);
    if(request.method!=='POST'||url.search||request.headers.has('origin')||request.headers.get('content-type')!=='application/json')return refused();
    const raw=await boundedBody(request),stamp=request.headers.get('x-legacy-web-job-timestamp')||'',nonce=request.headers.get('x-legacy-web-job-nonce')||'';
    if(!/^(0|[1-9][0-9]{0,15})$/.test(stamp)||!Number.isSafeInteger(Number(stamp))||Math.abs(now-Number(stamp))>60)return refused();
    const signing=await machineSigningInput(request.method,url.pathname,stamp,nonce,raw);
    if(!await hmacVerify(rawKey(env.ASSISTANT_WEB_JOB_KEY_HEX),request.headers.get('x-legacy-web-job-signature'),signing))return refused();
    // Unique durable nonce consumes each authenticated request before any job transition.
    await env.LEGACY_DB.prepare('INSERT INTO assistant_web_job_nonce(nonce,received_at) VALUES(?,?)').bind(nonce,now).run();
    const body=JSON.parse(raw),claim=url.pathname==='/api/assistant-web-jobs/claim';
    if(!exact(body,claim?CLAIM:RESULT)||!id(body.job_id)||!digest(body.input_digest)||!BINDING.every(k=>identifier(body[k])))return refused(400);
    row=await get(env.LEGACY_DB,body.job_id);
    if(!row||row.app_origin!==url.origin||row.input_digest!==body.input_digest)return refused();
    const frozen=await frozenFor(row,perimeter);
    if(claim){
      if(!id(body.pointer_nonce)||body.pointer_nonce!==row.pointer_nonce||!identifier(body.slack_event_id)||typeof body.slack_ts!=='string'||body.slack_ts.length>40||!/^[0-9]+\.[0-9]+$/.test(body.slack_ts)||row.pointer_expires_at<=now||row.expires_at<=now||row.state!=='pending'||!['reserved','sent'].includes(row.dispatch_state))return held();
      const lease=random128();
      const claimed=await env.LEGACY_DB.prepare("UPDATE assistant_web_job SET state='claimed',claim_json=?,claim_slack_ts=?,lease_token=?,lease_expires_at=? WHERE id=? AND state='pending' AND pointer_nonce=? AND input_digest=? AND pointer_expires_at>? AND dispatch_state IN ('reserved','sent') AND (dispatch_ts IS NULL OR dispatch_ts=?) RETURNING *").bind(canonical(body),body.slack_ts,lease,now+180,row.id,body.pointer_nonce,body.input_digest,now,body.slack_ts).first();
      if(!claimed)return held();
      return reply({ok:true,job_id:row.id,input_digest:row.input_digest,lease_token:lease,lease_expires_at:now+180,frozen});
    }
    if(!id(body.lease_token)||!digest(body.result_digest)||!['proposal','refused'].includes(body.status))return refused(400);
    const {result_digest,...unsigned}=body;
    if(result_digest!==await sha(canonical(unsigned)))return refused();
    const original=JSON.parse(row.claim_json||'null');
    if(!original||body.lease_token!==row.lease_token||!BINDING.every(k=>body[k]===original[k]))return held();
    if(['result','refused','materializing','materialized'].includes(row.state)){
      if(row.result_digest===result_digest)return reply({ok:true,job_id:row.id,state:row.state});
      await hold(env.LEGACY_DB,row.id);return held();
    }
    if(row.state!=='claimed'||row.lease_expires_at<=now||row.expires_at<=now){await hold(env.LEGACY_DB,row.id);return held();}
    if(body.status==='refused'?body.proposal!==null:!validProposal(frozen.area,body.proposal)){await hold(env.LEGACY_DB,row.id);return held();}
    const saved=await cas(env.LEGACY_DB,row.id,'claimed',body.status==='refused'?'refused':'result',{result_digest,result_json:canonical(body)});
    if(!saved){
      const concurrent=await get(env.LEGACY_DB,row.id);
      if(['result','refused','materializing','materialized'].includes(concurrent?.state)&&concurrent.result_digest===result_digest)return reply(view(concurrent));
      await hold(env.LEGACY_DB,row.id);return held();
    }
    return reply(view(saved));
  }catch{return refused(409);} // Fixed code only; raw request/actor/provider/result never logged.
}

export async function humanWebJob(context,now=Math.floor(Date.now()/1000)){
  const {request,env}=context;let row;
  try{
    const url=new URL(request.url);
    if(request.method==='GET'&&url.pathname==='/api/agent/web-jobs'&&!url.search&&!enabled(env))return confirmationActor(context.data)?reply({ok:true,enabled:false}):refused();
    const perimeter=configuration(env,url.origin);const actor=await actorFor(context);
    if(actor&&request.method==='GET'&&url.pathname==='/api/agent/web-jobs'&&!url.search)return reply({ok:true,enabled:true});
    if(!actor||request.method!=='POST'||url.pathname!=='/api/agent/web-jobs'||url.search||request.headers.get('origin')!==url.origin)return refused();
    const body=JSON.parse(await boundedBody(request));
    if(!exact(body,['action','job_id'])||!id(body.job_id)||!['status','materialize'].includes(body.action))return refused();
    row=await get(env.LEGACY_DB,body.job_id);if(!row||row.actor!==actor||row.app_origin!==url.origin)return refused(404);
    if(row.state!=='materialized'&&(row.expires_at<=now||row.state==='pending'&&row.pointer_expires_at<=now||row.state==='claimed'&&row.lease_expires_at<=now)){await hold(env.LEGACY_DB,row.id);return held();}
    if(body.action==='status')return reply(view(row));
    if(row.state==='materialized')return reply(JSON.parse(row.materialized_json));
    if(row.state!=='result')return held();
    const frozen=await frozenFor(row,perimeter),fresh=await snapshot(env.LEGACY_DB,frozen.area);
    if(frozen.actor!==actor||frozen.target_id!==TARGETS[frozen.area]||fresh.revision!==frozen.revision){await hold(env.LEGACY_DB,row.id);return held();}
    const proposal=JSON.parse(row.result_json).proposal;if(!validProposal(frozen.area,proposal))return held();
    if(!await cas(env.LEGACY_DB,row.id,'result','materializing'))return held();
    const mapper=async()=>content(frozen.area)?{ok:true,change:{section_key:frozen.current.section_key,...proposal.payload}}:{ok:true,...proposal};
    const path=content(frozen.area)?'/api/agent/draft':'/api/agent/change/draft';
    const draftBody={...(content(frozen.area)?{type_id:'page_section'}:{area:frozen.area}),target_id:frozen.target_id,request:frozen.request};
    // Internal server-only mapper injection, never body identity/proposal; no second model/CF fallback.
    const result=await agentPost({request:new Request(url.origin+path,{method:'POST',headers:{origin:url.origin,'content-type':'application/json'},body:JSON.stringify(draftBody)}),env:{...env,ASSISTANT_WEB_JOBS_ENABLED:'0',AGENT_MAPPER_BACKEND:mapper},data:context.data,redactErrors:true,draftGuards:[draftGuard(env.LEGACY_DB,row,fresh,now)]});
    const draft=await result.json(),draftId=content(frozen.area)?draft.draft_id:draft.change_id;
    if(!result.ok||draft.ok!==true||typeof draftId!=='string'||!digest(draft.preview_version))throw Error('draft');
    const saved=await env.LEGACY_DB.prepare(`SELECT * FROM ${content(frozen.area)?'content_item':'agent_change'} WHERE id=?`).bind(draftId).first();
    if(!saved||!ownsDraft(content(frozen.area)?saved.updated_by:saved.requested_by,actor))throw Error('owner');
    if(!await cas(env.LEGACY_DB,row.id,'materializing','materialized',{materialized_json:JSON.stringify(draft)}))throw Error('state');
    return reply(draft);
  }catch{if(row){try{await hold(env.LEGACY_DB,row.id);}catch{ /* A reserved materialization never retries. */ }}return held();}
}
