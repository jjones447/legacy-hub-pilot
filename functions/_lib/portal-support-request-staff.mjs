// Unmounted Staff store. verifiedEmail MUST come from the current verified Access
// context; accepting an email parameter here is not an authentication mechanism.
import {canAdvanceSupportStatus,projectSupportStatus} from './portal-support-request-contract.mjs';
export async function updateSupportStatus(db,verifiedEmail,body){
 if(typeof verifiedEmail!=='string'||!body||Object.getPrototypeOf(body)!==Object.prototype||
  Reflect.ownKeys(body).some(k=>!['id','revision','status'].includes(k)||Object.getOwnPropertyDescriptor(body,k)?.get||Object.getOwnPropertyDescriptor(body,k)?.set)||
  typeof body.id!=='string'||!body.id||body.id.length>160||!Number.isSafeInteger(body.revision)||body.revision<1||
  !projectSupportStatus(body.status))return {ok:false,error:'invalid_request'};
 const staff=await db.prepare("SELECT email FROM staff_member WHERE email=? AND status='active' AND role IN ('staff','admin')").bind(verifiedEmail).first();
 if(!staff)return {ok:false,error:'forbidden'};
 const before=await db.prepare('SELECT id,status,revision FROM portal_support_request WHERE id=?').bind(body.id).first();
 if(!before||before.revision!==body.revision)return {ok:false,error:'conflict'};
 if(!canAdvanceSupportStatus(before.status,body.status))return {ok:false,error:'invalid_transition'};
 const statements=[
  db.prepare(`UPDATE portal_support_request SET status=?,revision=revision+1,updated_at=datetime('now') WHERE id=? AND revision=? AND status=? AND EXISTS(SELECT 1 FROM staff_member WHERE email=? AND status='active' AND role IN ('staff','admin'))`).bind(body.status,body.id,body.revision,before.status,verifiedEmail),
  // SQLite/D1 changes() semantics across the native batch require qualification.
  // A stale/revoked zero-row update must never append a misleading success audit.
  db.prepare(`INSERT INTO audit_log(actor,action,entity,entity_id,before_json,after_json) SELECT ?,'portal.support_request.status','portal_support_request',?,?,? WHERE changes()=1`).bind('staff:'+verifiedEmail,body.id,JSON.stringify({revision:body.revision,status:before.status}),JSON.stringify({revision:body.revision+1,status:body.status})),
 ];
 let results;try{results=await db.batch(statements);}catch{return {ok:false,error:'outcome_unknown'};}
 if(results?.[0]?.meta?.changes!==1)return {ok:false,error:'conflict'};
 if(results?.[1]?.meta?.changes!==1)return {ok:false,error:'outcome_unknown'};
 return {ok:true,id:body.id,revision:body.revision+1,status:projectSupportStatus(body.status)};
}
