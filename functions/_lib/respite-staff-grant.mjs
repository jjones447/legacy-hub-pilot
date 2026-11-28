// Unmounted. verifiedEmail is trusted human Staff context from the dispatcher,
// not a body actor, email lookup authentication, or in-product agent capability.
export async function setRespiteStaffEligibility(db, verifiedEmail, command) {
 if(typeof verifiedEmail!=='string'||!verifiedEmail||verifiedEmail.length>254
  ||!command||Object.getPrototypeOf(command)!==Object.prototype
  ||Reflect.ownKeys(command).some(k=>!['caregiver_id','revision','enabled'].includes(k)||Object.getOwnPropertyDescriptor(command,k)?.get||Object.getOwnPropertyDescriptor(command,k)?.set)
  ||typeof command.caregiver_id!=='string'||!/^[-A-Za-z0-9_]{1,160}$/.test(command.caregiver_id)
  ||!Number.isSafeInteger(command.revision)||command.revision<0||command.revision>=Number.MAX_SAFE_INTEGER||typeof command.enabled!=='boolean')return {ok:false,error:'invalid_command'};
 const staff=()=>db.prepare("SELECT email FROM staff_member WHERE email=? AND status='active' AND role IN ('staff','admin')").bind(verifiedEmail).first();
 if(!await staff())return {ok:false,error:'forbidden'};
 if(!await db.prepare("SELECT id FROM caregiver WHERE id=? AND status!='archived'").bind(command.caregiver_id).first())return {ok:false,error:'unavailable'};
 const old=await db.prepare('SELECT revision,enabled FROM respite_staff_eligibility WHERE caregiver_id=?').bind(command.caregiver_id).first();
 if((old?.revision??0)!==command.revision)return {ok:false,error:'conflict'};
 const next=command.revision+1;
 const write=command.revision===0
  ?db.prepare(`INSERT INTO respite_staff_eligibility(caregiver_id,enabled,revision,updated_by) VALUES(?,?,1,?) ON CONFLICT(caregiver_id) DO NOTHING`).bind(command.caregiver_id,Number(command.enabled),verifiedEmail)
  :db.prepare(`UPDATE respite_staff_eligibility SET enabled=?,revision=?,updated_by=?,updated_at=datetime('now') WHERE caregiver_id=? AND revision=?`).bind(Number(command.enabled),next,verifiedEmail,command.caregiver_id,command.revision);
 try {
  const result=await db.batch([write,
   db.prepare(`INSERT INTO audit_log(actor,action,entity,entity_id,before_json,after_json)
    VALUES(CASE WHEN changes()=1 AND EXISTS(SELECT 1 FROM staff_member WHERE email=? AND status='active' AND role IN ('staff','admin')) THEN ? ELSE NULL END,
    'respite.eligibility.set','respite_staff_eligibility',?,?,?)`).bind(verifiedEmail,'staff:'+verifiedEmail,command.caregiver_id,JSON.stringify({revision:command.revision,enabled:old?Boolean(old.enabled):null}),JSON.stringify({revision:next,enabled:command.enabled}))]);
  if(!Array.isArray(result)||result.length!==2||result.some(x=>x?.meta?.changes!==1))return {ok:false,error:'outcome_unknown'};
  return {ok:true,revision:next,enabled:command.enabled};
 }catch{return {ok:false,error:'outcome_unknown'};}
}
