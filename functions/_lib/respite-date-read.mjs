// Unmounted candidate. A date read is neither eligibility authorization nor a
// reservation. The caller must qualify the server-side owner/eligibility first;
// the eventual writer must recheck the session and capacity atomically.
const ID = /^[A-Za-z0-9_-]{1,160}$/;
export async function readAvailableRespiteDates(db, ownerId) {
  if (typeof ownerId !== 'string' || !ID.test(ownerId)) return {ok:false,error:'unauthorized'};
  const active = () => db.prepare("SELECT id FROM caregiver WHERE id=? AND status!='archived'").bind(ownerId).first();
  if (!await active()) return {ok:false,error:'unauthorized'};
  const rows = await db.prepare(`SELECT e.id,e.title,e.starts_at,e.ends_at,e.location
    FROM event e WHERE e.respite_review_required=1 AND e.publish_state='published'
    AND julianday(e.starts_at)>julianday('now') AND e.capacity>0
    AND (SELECT count(*) FROM registration r WHERE r.event_id=e.id
      AND r.status IN ('registered','attended'))<e.capacity
    ORDER BY julianday(e.starts_at),e.id LIMIT 50`).all();
  if (!await active()) return {ok:false,error:'unauthorized'};
  return {ok:true,dates:rows.results.map(r=>({id:r.id,title:r.title,starts_at:r.starts_at,ends_at:r.ends_at,location:r.location}))};
}
