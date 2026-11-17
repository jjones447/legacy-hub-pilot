// Unwired source slice. Actor must come from verified portal auth, NOT request data.
// No routes import this module; no collection enablement or D1 deployment.
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const requestColumns = ['id','caregiver_id','participant_id','event_id','request_key','payload_digest','details_json','participant_revision','revision','status','needs_review','first_time','followup_by','followup_at','reviewed_by','reviewed_at','reviewed_revision','privacy_version','nonmedical_version','acknowledged_at','registration_id','removed_at','created_at','updated_at'];
const participantColumns = ['id','caregiver_id','revision','details_json','created_at','updated_at'];
const registrationColumns = ['id','caregiver_id','event_id','status','source','external_ref','created_at','updated_at'];
const denied = error => ({ ok: false, error });
const snapshot = (table, columns, row, params) => {
  params.push(...columns.map(c => row[c] ?? null));
  return `EXISTS(SELECT 1 FROM ${table} WHERE ${columns.map(c => `${c} IS ?`).join(' AND ')})`;
};
export async function writeOwnerChange(db, actor, command) {
  if (!ID.test(actor || '') || !command || Object.keys(command).some(k => !['action','id','revision','details','first_time'].includes(k)) ||
      !['update_request','withdraw_request','remove_participant'].includes(command.action) || !ID.test(command.id || '') ||
      !Number.isSafeInteger(command.revision) || command.revision < 1) return denied('invalid_command');
  const removing = command.action === 'remove_participant';
  const editing = command.action === 'update_request';
  if (!editing && ('details' in command || 'first_time' in command)) return denied('invalid_command');
  // Typed clinical/program field validation remains a separate required caller layer.
  // This slice refuses arbitrary JSON and accepts only the already reviewed field set.
  let details;
  if (editing) {
    const allowed = ['caregiver_name','contact_email','contact_phone','participant_name','age','relationship','mobility','communication','personal_care_detail','safety','allergies_diet','activities','comfort','emergency_name','emergency_relationship','emergency_phone'];
    if (!command.details || Array.isArray(command.details) || typeof command.details !== 'object' ||
        !Object.keys(command.details).length || Object.entries(command.details).some(([k,v]) => !allowed.includes(k) || typeof v !== 'string' || v.length > 600) || typeof command.first_time !== 'boolean') return denied('invalid_details');
    details = JSON.stringify(command.details);
    if (new TextEncoder().encode(details).length > 12000) return denied('invalid_details');
  }
  let rows, participant;
  try {
    if (removing) {
      participant = await db.prepare('SELECT * FROM respite_participant WHERE id=? AND caregiver_id=?').bind(command.id,actor).first();
      if (!participant || participant.revision !== command.revision) return denied('stale_or_forbidden');
      rows = (await db.prepare('SELECT * FROM respite_request WHERE participant_id=? ORDER BY id').bind(command.id).all()).results;
    } else {
      const row = await db.prepare('SELECT * FROM respite_request WHERE id=? AND caregiver_id=?').bind(command.id,actor).first();
      if (!row || row.revision !== command.revision || row.removed_at) return denied('stale_or_forbidden');
      rows = [row];
    }
    if (!Array.isArray(rows) || rows.some(r => r.caregiver_id !== actor)) return denied('stale_or_forbidden');
    const registrations = [];
    for (const row of rows) {
      if (row.registration_id == null) continue;
      const reg = await db.prepare('SELECT * FROM registration WHERE id=?').bind(row.registration_id).first();
      if (!reg || reg.caregiver_id !== actor || reg.event_id !== row.event_id || !['registered','cancelled'].includes(reg.status)) return denied('staff_resolution_required');
      const event = await db.prepare('SELECT starts_at FROM event WHERE id=?').bind(row.event_id).first();
      if (!event || !Number.isFinite(Date.parse(event.starts_at)) || Date.parse(event.starts_at) <= Date.now()) return denied('staff_resolution_required');
      registrations.push(reg);
    }
    const params = [actor];
    const guards = ["EXISTS(SELECT 1 FROM caregiver WHERE id=? AND status!='archived')"];
    if (participant) {
      guards.push(snapshot('respite_participant',participantColumns,participant,params));
      guards.push('(SELECT count(*) FROM respite_request WHERE participant_id=?)=?'); params.push(participant.id,rows.length);
    }
    for (const row of rows) guards.push(snapshot('respite_request',requestColumns,row,params));
    for (const reg of registrations) { guards.push("EXISTS(SELECT 1 FROM event WHERE id=? AND julianday(starts_at)>julianday('now'))"); params.push(reg.event_id); }
    for (const reg of registrations) guards.push(snapshot('registration',registrationColumns,reg,params));
    // Fail NOT NULL actor in statement zero when ANY read snapshot is stale.
    const op = `respite_owner_${crypto.randomUUID()}`;
    const audit = JSON.stringify({ op, revision: command.revision, action: command.action });
    const statements = [db.prepare(`INSERT INTO audit_log(actor,action,entity,entity_id,after_json)
      VALUES(CASE WHEN ${guards.join(' AND ')} THEN ? ELSE NULL END,'respite.owner_change','respite',?,?)`)
      .bind(...params,actor,command.id,audit)];
    const gate = "EXISTS(SELECT 1 FROM audit_log WHERE action='respite.owner_change' AND json_extract(after_json,'$.op')=?)";
    const expected = [1];
    for (const reg of registrations.filter(r => r.status === 'registered')) {
      statements.push(db.prepare(`UPDATE registration SET status='cancelled',updated_at=datetime('now') WHERE id=? AND ${gate}`).bind(reg.id,op)); expected.push(1);
    }
    for (const row of rows) {
      const redacting = !editing;
      statements.push(db.prepare(`UPDATE respite_request SET details_json=?,participant_id=?,status=?,needs_review=1,
        reviewed_by=NULL,reviewed_at=NULL,reviewed_revision=NULL,followup_by=NULL,followup_at=NULL,
        first_time=?,revision=revision+1,removed_at=?,updated_at=datetime('now') WHERE id=? AND revision=? AND ${gate}`)
        .bind(redacting ? null : details, removing ? null : row.participant_id, editing ? 'pending' : 'withdrawn',
          editing ? Number(command.first_time) : row.first_time, redacting ? (row.removed_at || new Date().toISOString()) : null,row.id,row.revision,op)); expected.push(1);
    }
    if (participant) {
      statements.push(db.prepare(`DELETE FROM respite_participant WHERE id=? AND caregiver_id=? AND revision=? AND ${gate}`).bind(participant.id,actor,participant.revision,op)); expected.push(1);
    }
    let results;
    try { results = await db.batch(statements); }
    catch { return denied('outcome_unconfirmed'); } // Never retry an unknown provider outcome.
    if (!Array.isArray(results) || results.length !== expected.length || results.some((r,i) => r.success !== true || r.meta?.changes !== expected[i])) return denied('outcome_unconfirmed');
    return { ok: true, operation_id: op };
  } catch { return denied('unavailable'); }
}
