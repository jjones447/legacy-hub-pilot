import {currentRespiteAckVersions} from './respite-acknowledgments.mjs';
// Unmounted selective candidate. ownerId/ackVersions are server context, NOT
// browser identity or approval. No participant creation or Staff confirmation.
const ID=/^[A-Za-z0-9_-]{1,160}$/;
const plain=v=>v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype;
export function validatePendingRespiteCreate(body){
 const keys=['request_id','participant_id','participant_revision','event_id','first_time','privacy_ack','nonmedical_ack'];
 if(!plain(body)||Reflect.ownKeys(body).some(k=>!keys.includes(k)||Object.getOwnPropertyDescriptor(body,k)?.get||Object.getOwnPropertyDescriptor(body,k)?.set))return null;
 if(typeof body.request_id!=='string'||!/^[-A-Za-z0-9_]{16,80}$/.test(body.request_id)||typeof body.participant_id!=='string'||!ID.test(body.participant_id)||typeof body.event_id!=='string'||!ID.test(body.event_id)||!Number.isSafeInteger(body.participant_revision)||body.participant_revision<1||typeof body.first_time!=='boolean'||body.privacy_ack!==true||body.nonmedical_ack!==true)return null;
 return {...body};
}
async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
const ownerActive=(db,id)=>db.prepare("SELECT id FROM caregiver WHERE id=? AND status!='archived'").bind(id).first();
const find=(db,owner,key)=>db.prepare("SELECT r.* FROM respite_request r JOIN caregiver c ON c.id=r.caregiver_id WHERE r.request_key=? AND r.caregiver_id=? AND c.status!='archived'").bind(key,owner).first();
const receipt=r=>({id:r.id,event_id:r.event_id,participant_id:r.participant_id,revision:r.revision,status:r.status,needs_review:Boolean(r.needs_review),created_at:r.created_at});
export async function createPendingRespiteRequest(db,ownerId,body,ackVersions){
 const input=validatePendingRespiteCreate(body);
 if(typeof ownerId!=='string'||!ID.test(ownerId)||!input)return {ok:false,error:'invalid_request'};
 if(!currentRespiteAckVersions(ackVersions))return {ok:false,error:'unavailable'};
 if(!await ownerActive(db,ownerId))return {ok:false,error:'unauthorized'};
 const participant=await db.prepare('SELECT id,revision,details_json FROM respite_participant WHERE id=? AND caregiver_id=?').bind(input.participant_id,ownerId).first();
 if(!participant||participant.revision!==input.participant_revision)return {ok:false,error:'stale_or_forbidden'};
 const key=await hash(JSON.stringify([ownerId,input.request_id]));
 const digest=await hash(JSON.stringify([input.event_id,participant.id,participant.revision,participant.details_json,input.first_time,ackVersions.privacy,ackVersions.nonmedical]));
 const old=await find(db,ownerId,key);
 if(old)return old.payload_digest===digest?{ok:true,...receipt(old),replayed:true}:{ok:false,error:'idempotency_conflict'};
 const id='rr_'+crypto.randomUUID();
 try{await db.batch([
  db.prepare(`INSERT INTO respite_request(id,caregiver_id,participant_id,event_id,request_key,payload_digest,details_json,participant_revision,first_time,privacy_version,nonmedical_version,acknowledged_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`).bind(id,ownerId,participant.id,input.event_id,key,digest,participant.details_json,participant.revision,input.first_time?1:0,ackVersions.privacy,ackVersions.nonmedical),
  db.prepare("INSERT INTO audit_log(actor,action,entity,entity_id,after_json) VALUES(?,'respite.request.pending','respite_request',?,?)").bind('caregiver:'+ownerId,id,JSON.stringify({revision:1,participant_revision:participant.revision,status:'pending'}))
 ]);}catch(error){const winner=await find(db,ownerId,key);if(winner)return winner.payload_digest===digest?{ok:true,...receipt(winner),replayed:true}:{ok:false,error:'idempotency_conflict'};throw error;}
 const saved=await find(db,ownerId,key);return saved?{ok:true,...receipt(saved),replayed:false}:{ok:false,error:'unavailable'};
}
export async function readOwnerRespiteRequests(db,ownerId){
 if(typeof ownerId!=='string'||!ID.test(ownerId)||!await ownerActive(db,ownerId))return {ok:false,error:'unauthorized'};
 const r=await db.prepare("SELECT r.id,r.event_id,r.participant_id,r.revision,r.status,r.needs_review,r.created_at FROM respite_request r JOIN caregiver c ON c.id=r.caregiver_id WHERE r.caregiver_id=? AND c.status!='archived' ORDER BY r.created_at DESC,r.id DESC LIMIT 50").bind(ownerId).all();
 if(!await ownerActive(db,ownerId))return {ok:false,error:'unauthorized'};
 return {ok:true,requests:r.results.map(receipt)};
}
