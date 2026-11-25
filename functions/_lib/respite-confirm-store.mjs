// Unmounted first-confirm candidate. verifiedEmail/currentAck are server context,
// never browser identity/approval. Follow-up/reconfirmation/Attendance are separate.
export async function confirmPendingRespiteRequest(db,verifiedEmail,command,currentAck){
 if(typeof verifiedEmail!=='string'||!verifiedEmail||verifiedEmail.length>254||!command||Object.getPrototypeOf(command)!==Object.prototype||Reflect.ownKeys(command).some(k=>!['id','revision'].includes(k)||Object.getOwnPropertyDescriptor(command,k)?.get||Object.getOwnPropertyDescriptor(command,k)?.set)||typeof command.id!=='string'||!/^[-A-Za-z0-9_]{1,160}$/.test(command.id)||!Number.isSafeInteger(command.revision)||command.revision<1)return {ok:false,error:'invalid_command'};
 if(!currentAck||!['privacy','nonmedical'].every(k=>typeof currentAck[k]==='string'&&/^[-A-Za-z0-9_.]{1,80}$/.test(currentAck[k])))return {ok:false,error:'unavailable'};
 const staff=await db.prepare("SELECT email FROM staff_member WHERE email=? AND status='active' AND role IN ('staff','admin')").bind(verifiedEmail).first();
 if(!staff)return {ok:false,error:'forbidden'};
 const before=await db.prepare('SELECT * FROM respite_request WHERE id=?').bind(command.id).first();
 if(!before||before.revision!==command.revision||before.status!=='pending'||before.registration_id!==null)return {ok:false,error:'conflict'};
 if(before.privacy_version!==currentAck.privacy||before.nonmedical_version!==currentAck.nonmedical)return {ok:false,error:'new_acknowledgment_required'};
 if(before.first_time&&(!before.followup_by||!before.followup_at))return {ok:false,error:'followup_required'};
 const rev=command.revision;
 try{const results=await db.batch([
  db.prepare(`UPDATE respite_request SET status='confirmed',needs_review=0,revision=revision+1,reviewed_revision=revision+1,reviewed_by=?,reviewed_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND revision=? AND status='pending' AND registration_id IS NULL AND needs_review=1 AND EXISTS(SELECT 1 FROM staff_member WHERE email=? AND status='active' AND role IN ('staff','admin')) AND EXISTS(SELECT 1 FROM caregiver WHERE id=respite_request.caregiver_id AND status!='archived')`).bind(verifiedEmail,command.id,rev,verifiedEmail),
  db.prepare(`INSERT INTO registration(caregiver_id,event_id,status,source,external_ref) SELECT caregiver_id,event_id,'registered','respite_owner_v1',id FROM respite_request WHERE id=? AND revision=? AND reviewed_by=? AND changes()=1`).bind(command.id,rev+1,verifiedEmail),
  db.prepare(`UPDATE respite_request SET registration_id=(SELECT id FROM registration WHERE source='respite_owner_v1' AND external_ref=?),revision=revision+1,reviewed_revision=revision+1,updated_at=datetime('now') WHERE id=? AND revision=? AND reviewed_by=? AND changes()=1`).bind(command.id,command.id,rev+1,verifiedEmail),
  // A zero-row/stale/revoked intermediate result MUST abort the transaction,
  // not silently commit a reservation without the final link/audit.
  db.prepare(`INSERT INTO audit_log(actor,action,entity,entity_id,before_json,after_json) VALUES(CASE WHEN changes()=1 AND EXISTS(SELECT 1 FROM respite_request r JOIN registration g ON g.id=r.registration_id JOIN staff_member s ON s.email=r.reviewed_by JOIN caregiver c ON c.id=r.caregiver_id WHERE r.id=? AND r.revision=? AND r.reviewed_revision=r.revision AND r.status='confirmed' AND r.reviewed_by=? AND s.status='active' AND s.role IN ('staff','admin') AND c.status!='archived' AND g.caregiver_id=r.caregiver_id AND g.event_id=r.event_id AND g.source='respite_owner_v1' AND g.external_ref=r.id AND g.status='registered') THEN ? ELSE NULL END,'respite.request.confirm','respite_request',?,?,?)`).bind(command.id,rev+2,verifiedEmail,'staff:'+verifiedEmail,command.id,JSON.stringify({revision:rev,status:'pending'}),JSON.stringify({revision:rev+2,status:'confirmed'}))
 ]);
 if(!Array.isArray(results)||results.length!==4||results.some(r=>r?.meta?.changes!==1))return {ok:false,error:'outcome_unknown'};
 return {ok:true,id:command.id,revision:rev+2,status:'confirmed'};
 }catch{return {ok:false,error:'outcome_unknown'};}
}
