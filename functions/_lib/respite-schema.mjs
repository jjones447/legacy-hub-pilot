// Derived from the selected composed candidate SQL, without fictional rows.
// The native SQLite/D1 representation must match before any route is admitted.
const RESPITE_SCHEMA_SHA256 = '2425b87d17793f1575e3993732cb701f5b26a478a642a68573610d2e8f1a1181';

export async function respiteSchemaIsReady(db) {
  try {
    const schema = await db.prepare(`SELECT name,sql FROM sqlite_master
      WHERE name GLOB 'respite_*' ORDER BY name`).all();
    if (!Array.isArray(schema.results)) return false;
    const bytes = new TextEncoder().encode(JSON.stringify(schema.results.map(({ name, sql }) => ({ name, sql }))));
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    if ([...hash].map(byte => byte.toString(16).padStart(2, '0')).join('') !== RESPITE_SCHEMA_SHA256) return false;

    // Check the read-source columns that live outside the candidate DDL. The
    // audit guard depends on actor rejecting NULL inside the batch.
    const columns = await db.prepare(`SELECT c.status,c.first_name,c.last_name,c.email,c.phone,p.revision,p.fields_json,p.restricted_json,
      s.needs_json,staff.status,staff.role,e.respite_review_required,e.capacity,e.starts_at,
      e.publish_state,e.title,e.ends_at,e.location,g.status,a.entity_id,a.after_json
      FROM caregiver c,caregiver_profile p,portal_support_request s,staff_member staff,
        event e,registration g,audit_log a LIMIT 0`).all();
    const auditActor = await db.prepare("SELECT [notnull] AS required FROM pragma_table_info('audit_log') WHERE name='actor'").first();
    return Array.isArray(columns.results) && auditActor?.required === 1;
  } catch {
    return false;
  }
}
