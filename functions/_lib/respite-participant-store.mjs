import {validateRespiteParticipantDetails} from './respite-participant-fields.mjs';
// Unmounted synthetic-only candidate. Owner ID is server-session context.
const ID=/^[-A-Za-z0-9_]{1,160}$/;
const active=(db,id)=>db.prepare("SELECT id FROM caregiver WHERE id=? AND status!='archived'").bind(id).first();
const find=(db,owner,id)=>db.prepare("SELECT p.id,p.revision,p.details_json FROM respite_participant p JOIN caregiver c ON c.id=p.caregiver_id WHERE p.id=? AND p.caregiver_id=? AND c.status!='archived'").bind(id,owner).first();
async function stableId(owner,key){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([owner,key])));return 'rp_'+[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function createRespiteParticipant(db,ownerId,command){
 if(typeof ownerId!=='string'||!ID.test(ownerId)||!command||Object.getPrototypeOf(command)!==Object.prototype||Reflect.ownKeys(command).some(k=>!['request_id','details'].includes(k)||Object.getOwnPropertyDescriptor(command,k)?.get||Object.getOwnPropertyDescriptor(command,k)?.set)||typeof command.request_id!=='string'||!/^[-A-Za-z0-9_]{16,80}$/.test(command.request_id))return {ok:false,error:'invalid_command'};
 const details=validateRespiteParticipantDetails(command.details);if(!details)return {ok:false,error:'invalid_details'};
 if(!await active(db,ownerId))return {ok:false,error:'unauthorized'};
 const id=await stableId(ownerId,command.request_id),serialized=JSON.stringify(details);
 const reconcile=row=>row.details_json===serialized?{ok:true,id:row.id,revision:row.revision,replayed:true}:{ok:false,error:'idempotency_conflict'};
 const old=await find(db,ownerId,id);if(old)return reconcile(old);
 try {
  const result=await db.batch([
   db.prepare("INSERT INTO respite_participant(id,caregiver_id,details_json) SELECT ?,id,? FROM caregiver WHERE id=? AND status!='archived' ON CONFLICT(id) DO NOTHING").bind(id,serialized,ownerId),
   db.prepare("INSERT INTO audit_log(actor,action,entity,entity_id,after_json) VALUES(CASE WHEN changes()=1 THEN ? ELSE NULL END,'respite.participant.create','respite_participant',?,?)").bind('caregiver:'+ownerId,id,JSON.stringify({revision:1}))
  ]);
  if(!Array.isArray(result)||result.length!==2||result.some(r=>r?.meta?.changes!==1))return {ok:false,error:'outcome_unknown'};
 }catch{const saved=await find(db,ownerId,id);return saved?reconcile(saved):{ok:false,error:'outcome_unknown'};}
 const saved=await find(db,ownerId,id);return saved&&saved.details_json===serialized?{ok:true,id,revision:saved.revision,replayed:false}:{ok:false,error:'outcome_unknown'};
}
export async function readOwnerRespiteParticipants(db,ownerId){
 if(typeof ownerId!=='string'||!ID.test(ownerId)||!await active(db,ownerId))return {ok:false,error:'unauthorized'};
 const rows=await db.prepare("SELECT p.id,p.revision,p.details_json FROM respite_participant p JOIN caregiver c ON c.id=p.caregiver_id WHERE p.caregiver_id=? AND c.status!='archived' ORDER BY p.id LIMIT 20").bind(ownerId).all();
 if(!await active(db,ownerId))return {ok:false,error:'unauthorized'};
 const participants=[];
 for(const row of rows.results){let details;try{details=validateRespiteParticipantDetails(JSON.parse(row.details_json));}catch{return {ok:false,error:'unavailable'};}if(!details)return {ok:false,error:'unavailable'};participants.push({id:row.id,revision:row.revision,details});}
 return {ok:true,participants};
}
