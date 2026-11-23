// Candidate store, not an authentication boundary. Only a wired verified server
// session may supply ownerId. Never pass browser actor/email/JSON identity here.
import {validateSupportRequest, projectSupportStatus} from './portal-support-request-contract.mjs';
const SOURCE='portal_owner_support_request';
async function hash(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function find(db,ownerId,key){return db.prepare(`SELECT r.* FROM portal_support_request r JOIN caregiver c ON c.id=r.caregiver_id WHERE r.caregiver_id=? AND r.request_key=? AND c.status='active'`).bind(ownerId,key).first();}
function receipt(row,replayed){return {id:row.id,revision:row.revision,status:projectSupportStatus(row.status),needs:JSON.parse(row.needs_json),preferred_contact:row.preferred_contact,created_at:row.created_at,replayed};}
export async function createOwnerSupportRequest(db,ownerId,body){
 const value=validateSupportRequest(body);
 if(typeof ownerId!=='string'||!ownerId||ownerId.length>160||!value)return {ok:false,error:'invalid_request'};
 const active=await db.prepare("SELECT id,phone,email FROM caregiver WHERE id=? AND status='active'").bind(ownerId).first();
 if(!active)return {ok:false,error:'unauthorized'};
 const payload=JSON.stringify({needs:value.needs,preferred_contact:value.preferred_contact,message:value.message});
 const digest=await hash(payload),externalRef=await hash(JSON.stringify([ownerId,value.request_id]));
 const existing=await find(db,ownerId,value.request_id);
 if(existing)return existing.payload_digest===digest?{ok:true,...receipt(existing,true)}:{ok:false,error:'idempotency_conflict'};
 if(!(value.preferred_contact==='email'?active.email:active.phone))return {ok:false,error:'contact_details_required'};
 const id=crypto.randomUUID();
 // The request VALUES statement must execute, even if the owner vanished after
 // the read: FK/NOT NULL/active-owner guards abort the whole atomic batch.
 const statements=[
  db.prepare(`INSERT INTO followup(caregiver_id,kind,detail,status,source,external_ref) SELECT id,'support_request','Portal support request','open',?,? FROM caregiver WHERE id=? AND status='active' AND CASE WHEN ?='email' THEN email IS NOT NULL AND length(trim(email))>0 ELSE phone IS NOT NULL AND length(trim(phone))>0 END`).bind(SOURCE,externalRef,ownerId,value.preferred_contact),
  db.prepare(`INSERT INTO portal_support_request(id,caregiver_id,request_key,payload_digest,needs_json,preferred_contact,message,followup_id) VALUES(?,?,?,?,?,?,?,(SELECT id FROM followup WHERE source=? AND external_ref=? AND caregiver_id=?))`).bind(id,ownerId,value.request_id,digest,JSON.stringify(value.needs),value.preferred_contact,value.message,SOURCE,externalRef,ownerId),
  db.prepare(`INSERT INTO audit_log(actor,action,entity,entity_id,after_json) VALUES(?, 'portal.support_request.create','portal_support_request',?,?)`).bind('caregiver:'+ownerId,id,JSON.stringify({revision:1,followup_source:SOURCE})),
 ];
 try{await db.batch(statements);}catch(error){
  // Concurrent same-key winner or lost-ack recovery, never blind retry/write.
  const winner=await find(db,ownerId,value.request_id);
  if(winner)return winner.payload_digest===digest?{ok:true,...receipt(winner,true)}:{ok:false,error:'idempotency_conflict'};
  throw error;
 }
 const saved=await find(db,ownerId,value.request_id);
 if(!saved)return {ok:false,error:'unavailable'};
 return {ok:true,...receipt(saved,false)};
}
export async function readOwnerSupportRequests(db,ownerId){
 if(typeof ownerId!=='string'||!ownerId||ownerId.length>160)return [];
 const result=await db.prepare(`SELECT r.* FROM portal_support_request r JOIN caregiver c ON c.id=r.caregiver_id WHERE r.caregiver_id=? AND c.status='active' ORDER BY r.created_at DESC,r.id DESC LIMIT 50`).bind(ownerId).all();
 return (result.results||[]).map(row=>receipt(row,false));
}
