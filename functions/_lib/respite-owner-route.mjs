// Draft portal boundary. No deployed flag/migration; production always unavailable.
import { writeOwnerChange } from './respite-owner-writer.mjs';
const VERSION = 'respite-owner-draft-v1';
const triggers = ['respite_participant_identity','respite_participant_revision','respite_request_identity','respite_request_owner_insert','respite_request_owner_update','respite_request_change','respite_request_no_revive','respite_request_reservation','respite_registration_no_revive','respite_request_revision','respite_request_receipt','respite_request_review_invalidation','respite_request_registration_lock','respite_request_registration_insert','respite_request_registration_update','respite_registration_identity'];
const reply = (error,status) => Response.json({ok:false,error},{status,headers:{'Cache-Control':'no-store'}});
async function readBody(request) {
 if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') || '') || !request.body) return null;
 const length=request.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>16000))return null;
 const reader=request.body.getReader();let size=0;const chunks=[];
 try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16000){await reader.cancel();return null;}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));return body&&typeof body==='object'&&!Array.isArray(body)?body:null; }
 catch{return null;}finally{reader.releaseLock();}
}
export async function handleOwnerRoute(request,env,resolveVerifiedActor) {
 // No schema query, credential/body access or observable auth when unavailable.
 if(env?.ENVIRONMENT!=='preview'||env?.RESPITE_OWNER_COLLECTION!==VERSION)return reply('unavailable',404);
 const url=new URL(request.url);const route=/^\/api\/portal\/respite\/(update|withdraw|remove)$/.exec(url.pathname);
 if(!route||url.search||url.hash)return reply('not_found',404);
 if(request.method!=='POST')return reply('method_not_allowed',405);
 if(request.headers.get('Origin')!==url.origin||![null,'same-origin'].includes(request.headers.get('Sec-Fetch-Site')))return reply('forbidden',403);
 let actor;try{actor=await resolveVerifiedActor();}catch{return reply('unauthorized',401);}
 if(!actor || typeof actor.id!=='string' || typeof actor.email!=='string')return reply('unauthorized',401);
 const body=await readBody(request);if(!body)return reply('invalid_body',400);
 const fields=route[1]==='update'?['id','revision','details','first_time']:['id','revision'];
 if(Object.keys(body).some(k=>!fields.includes(k)))return reply('invalid_body',400);
 try {
  const db=env.LEGACY_DB;
  await db.prepare('SELECT id,caregiver_id,participant_id,event_id,request_key,payload_digest,details_json,participant_revision,revision,status,needs_review,first_time,followup_by,followup_at,reviewed_by,reviewed_at,reviewed_revision,privacy_version,nonmedical_version,acknowledged_at,registration_id,removed_at,created_at,updated_at FROM respite_request LIMIT 0').all();
  await db.prepare('SELECT id,caregiver_id,revision,details_json,created_at,updated_at FROM respite_participant LIMIT 0').all();
  const found=(await db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all()).results;
  if(!Array.isArray(found)||!triggers.every(name=>found.some(x=>x.name===name)))return reply('unavailable',404);
  const schema=(await db.prepare("SELECT name,sql FROM sqlite_master WHERE name IN ('respite_request','respite_participant') OR (type='trigger' AND name LIKE 'respite_%') ORDER BY name").all()).results;
  if(!Array.isArray(schema))return reply('unavailable',404);
  const serialized=JSON.stringify(schema.map(r=>({name:r.name,sql:r.sql})));
  const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(serialized))),b=>b.toString(16).padStart(2,'0')).join('');
  // Reviewed source schema fingerprint; real D1 representation is still unqualified.
  if(fingerprint!=='9e577c8bcbc2f4b1174b7e920620f16d9a1f9b88ebb802674439780a5401e5b7')return reply('unavailable',404);
  const action={update:'update_request',withdraw:'withdraw_request',remove:'remove_participant'}[route[1]];
  const result=await writeOwnerChange(db,actor.id,{...body,action},actor.email);
  if(!result.ok)return reply(result.error,result.error==='outcome_unconfirmed'?502:result.error==='invalid_command'||result.error==='invalid_details'?400:409);
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch{return reply('unavailable',404);}
}
