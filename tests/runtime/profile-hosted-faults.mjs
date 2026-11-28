// TEST-ONLY native-D1 adapter candidate. Not in product routes; no active manifest.
// The durable ledger is additive test infrastructure, NOT a product migration.
export const LEDGER_SQL = `CREATE TABLE profile_qualification_operation (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, revision INTEGER NOT NULL,
  scenario TEXT NOT NULL, ticket TEXT NOT NULL, phase TEXT NOT NULL,
  before_json TEXT NOT NULL, outcome TEXT
);
CREATE UNIQUE INDEX profile_qualification_owner_inflight
ON profile_qualification_operation(owner) WHERE phase != 'cleaned'`;
export const TRIGGER_NAME = 'profile_ct13_audit_fault_20261121';
export const AUDIT_TRIGGER_SQL = `CREATE TRIGGER ${TRIGGER_NAME}
BEFORE INSERT ON audit_log
WHEN NEW.actor = 'profile_ct13_20261121_a_571d390c'
  AND NEW.action = 'portal.profile_saved'
  AND NEW.entity = 'caregiver_profile'
  AND NEW.entity_id = 'profile_ct13_20261121_a_571d390c'
BEGIN
  SELECT RAISE(ABORT, 'profile_fixture_audit_fault');
END`;
const OWNER_A = 'profile_ct13_20261121_a_571d390c';
const OWNER_B = 'profile_ct13_20261121_b_82e4a90f';
const normalSQL = sql => String(sql).trim().replace(/;$/, '');
const fail = () => { throw new Error('profile_fixture_fault_stopped'); };
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, sorted(val)])) : value;
const canonical = value => JSON.stringify(sorted(value));
export async function caregiverDigest(row) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(row)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export async function profileFaultWitness(db, owner) {
  if (![OWNER_A, OWNER_B].includes(owner)) fail();
  async function rows(sql) {
    const result = await db.prepare(sql).bind(owner).all();
    if (result?.success !== true || !Array.isArray(result.results)) fail();
    return result.results;
  }
  return {
    caregiver: await db.prepare('SELECT * FROM caregiver WHERE id = ?').bind(owner).first(),
    profiles: await rows('SELECT * FROM caregiver_profile WHERE caregiver_id = ? ORDER BY caregiver_id'),
    audits: await rows('SELECT * FROM audit_log WHERE actor = ?1 OR entity_id = ?1 ORDER BY id'),
    followups: await rows('SELECT * FROM followup WHERE caregiver_id = ? ORDER BY id'),
  };
}
const good = (result, changes) => result?.success === true && result.meta?.changes === changes;
const allGood = results => Array.isArray(results) && results.every(r => r?.success === true && Number.isInteger(r.meta?.changes));
function validate(plan) {
  if (!plan || !/^profile_fault_20261121_[a-z0-9_]+$/.test(plan.id || '')
      || !['audit', 'archive'].includes(plan.scenario)
      || ![OWNER_A, OWNER_B].includes(plan.owner)
      || !Number.isSafeInteger(plan.revision) || plan.revision < 0
      || !/^[a-f0-9]{64}$/.test(plan.caregiverHash || '')
      || !/^[a-f0-9]{64}$/.test(plan.witnessHash || '')
      || (plan.scenario === 'audit' && (plan.owner !== OWNER_A || plan.revision !== 4))
      || (plan.owner === OWNER_A && plan.revision !== 4)
      || (plan.owner === OWNER_B && plan.revision !== 0)) fail();
  return Object.freeze({ ...plan });
}
function predicate(row, args) {
  const columns = Object.keys(row).sort();
  if (!columns.length || columns.some(key => !/^[a-z_][a-z0-9_]*$/.test(key))) fail();
  return columns.map(key => { args.push(row[key]); return `"${key}" IS ?`; }).join(' AND ');
}
async function operation(db, plan) {
  return db.prepare('SELECT * FROM profile_qualification_operation WHERE id = ?').bind(plan.id).first();
}
function matches(row, plan, ticket) {
  return row?.owner === plan.owner && row.revision === plan.revision
    && row.scenario === plan.scenario && row.ticket === ticket;
}
async function trigger(db) {
  return db.prepare("SELECT type, sql FROM sqlite_master WHERE name = ?").bind(TRIGGER_NAME).first();
}
function exactTrigger(row) { return row?.type === 'trigger' && normalSQL(row.sql) === AUDIT_TRIGGER_SQL; }
async function phase(db, plan, ticket, expected) {
  const row = await operation(db, plan);
  if (!matches(row, plan, ticket) || row.phase !== expected) fail();
  return row;
}
// A failing CASE aborts the D1 transaction before DDL. This closes the gap
// between an outer schema read and CREATE/DROP if the object or custody drifts.
function ddlGuard(db, plan, ticket, expected, present) {
  const objectGuard = present
    ? "EXISTS (SELECT 1 FROM sqlite_master WHERE name = ? AND type = 'trigger' AND rtrim(trim(sql), ';') = ?)"
    : 'NOT EXISTS (SELECT 1 FROM sqlite_master WHERE name = ?)';
  return db.prepare(`SELECT CASE WHEN
    EXISTS (SELECT 1 FROM profile_qualification_operation WHERE id = ? AND ticket = ? AND phase = ?)
    AND ${objectGuard} THEN 1 ELSE abs(-9223372036854775808) END AS qualified`)
    .bind(plan.id, ticket, expected, TRIGGER_NAME, ...(present ? [AUDIT_TRIGGER_SQL] : []));
}
// Explicit cleanup is also the only permitted restart recovery. It never retries
// an original operation, injection, CREATE, or owner transition.
export async function recoverProfileFault(db, input) {
  const plan = validate(input), row = await operation(db, plan);
  if (!row || row.owner !== plan.owner || row.revision !== plan.revision || row.scenario !== plan.scenario) fail();
  const ticket = row.ticket;
  const witness = JSON.parse(row.before_json), before = witness.caregiver;
  if (await caregiverDigest(witness) !== plan.witnessHash) fail();
  if (before.id !== plan.owner || before.status !== 'active' || await caregiverDigest(before) !== plan.caregiverHash) fail();
  if (row.phase === 'claimed') {
    // Claim/transition UNKNOWN: original operation is spent, not automatically resumed.
    // An existing trigger here is not proven owned by this operation.
    if (plan.scenario === 'audit' && await trigger(db)) fail();
    return { phase: 'claimed', originalOperation: 'UNKNOWN_NO_REPLAY' };
  }
  if (row.phase === 'cleaned') {
    if (plan.scenario === 'audit' && await trigger(db)) fail();
    const current = await db.prepare('SELECT * FROM caregiver WHERE id = ?').bind(plan.owner).first();
    if (canonical(current) !== canonical(before) || canonical(await profileFaultWitness(db, plan.owner)) !== canonical(witness)) fail();
    return { phase: 'cleaned', originalOperation: row.outcome };
  }
  if (row.phase !== 'injected') fail();
  if (plan.scenario === 'audit') {
    if (!exactTrigger(await trigger(db))) fail();
    // Transactional DDL + ledger state proves ownership even after a lost ack.
    try {
      const results = await db.batch([
        ddlGuard(db, plan, ticket, 'injected', true),
        db.prepare(`DROP TRIGGER ${TRIGGER_NAME}`),
        db.prepare("UPDATE profile_qualification_operation SET phase = 'cleaned' WHERE id = ? AND ticket = ? AND phase = 'injected'").bind(plan.id, ticket),
      ]);
      if (!allGood(results) || results.length !== 3 || !good(results[2], 1)) fail();
    } catch { /* Reconcile the original cleanup, never repeat DROP blindly. */ }
    await phase(db, plan, ticket, 'cleaned');
    if (await trigger(db)) fail();
  } else {
    const archived = { ...before, status: 'archived' }, args = [before.status];
    const guard = predicate(archived, args); args.push(plan.id, ticket);
    try {
      const results = await db.batch([
        db.prepare(`UPDATE caregiver SET status = ? WHERE ${guard}
          AND EXISTS (SELECT 1 FROM profile_qualification_operation WHERE id = ? AND ticket = ? AND phase = 'injected')`).bind(...args),
        db.prepare("UPDATE profile_qualification_operation SET phase = 'cleaned' WHERE id = ? AND ticket = ? AND phase = 'injected' AND changes() = 1").bind(plan.id, ticket),
      ]);
      if (!allGood(results) || results.length !== 2 || !good(results[0], 1) || !good(results[1], 1)) fail();
    } catch { /* Reconcile; never overwrite intervening caregiver drift. */ }
    await phase(db, plan, ticket, 'cleaned');
  }
  const current = await db.prepare('SELECT * FROM caregiver WHERE id = ?').bind(plan.owner).first();
  if (canonical(current) !== canonical(before) || canonical(await profileFaultWitness(db, plan.owner)) !== canonical(witness)) fail();
  return { phase: 'cleaned', originalOperation: (await operation(db, plan)).outcome };
}

// Constructed only from a source-pinned server manifest. The HTTP request cannot
// select a hook, operation ID, owner, revision, SQL, or cleanup mode.
export function createProfileFaultDb(db, input) {
  const plan = validate(input), metadata = new WeakMap();
  function wrap(sql, args = []) {
    const native = args.length ? db.prepare(sql).bind(...args) : db.prepare(sql);
    const statement = { bind: (...values) => wrap(sql, values),
      first: (...values) => native.first(...values), run: () => native.run(),
      all: () => native.all() };
    metadata.set(statement, { sql, args, native }); return statement;
  }
  return {
    prepare: sql => wrap(sql),
    async batch(statements) {
      const list = statements.map(s => metadata.get(s));
      if (list.length < 2 || list.length > 3 || list.some(s => !s)) fail();
      const first = list[0];
      // Exact product write shape: no arbitrary caller-provided DB statements.
      if (plan.revision === 0) {
        if (!first.sql.trim().startsWith('INSERT INTO caregiver_profile (caregiver_id, revision, fields_json, restricted_json)')
            || first.args.length !== 3 || first.args[2] !== plan.owner) fail();
      } else if (!first.sql.trim().startsWith('UPDATE caregiver_profile SET fields_json = ?, restricted_json = ?, revision = ?')
          || first.args.length !== 5 || first.args[2] !== plan.revision + 1
          || first.args[3] !== plan.owner || first.args[4] !== plan.revision) fail();
      if (!list[1].sql.includes("'portal.profile_saved'") || list[1].args[0] !== plan.owner
          || list[1].args[1] !== plan.owner || list[1].args[2] !== JSON.stringify({ revision: plan.revision + 1 })) fail();
      const before = await db.prepare('SELECT * FROM caregiver WHERE id = ?').bind(plan.owner).first();
      if (!before || before.status !== 'active' || await caregiverDigest(before) !== plan.caregiverHash) fail();
      const profile = await db.prepare('SELECT revision FROM caregiver_profile WHERE caregiver_id = ?').bind(plan.owner).first();
      if ((profile?.revision ?? 0) !== plan.revision || (plan.revision === 0 && profile)) fail();
      if (plan.scenario === 'audit' && await trigger(db)) fail();
      const witness = await profileFaultWitness(db, plan.owner);
      if (await caregiverDigest(witness) !== plan.witnessHash) fail();
      const previousFields = witness.profiles.length ? JSON.parse(witness.profiles[0].fields_json)
        : { first_name: before.first_name, last_name: before.last_name, phone: before.phone };
      const previousRestricted = witness.profiles.length ? JSON.parse(witness.profiles[0].restricted_json) : {};
      // Only the pinned contact-Yes test transition may consume this operation.
      // Arbitrary otherwise-valid form changes cannot select a different test.
      if (previousFields.contact_requested === 'Yes'
          || canonical(JSON.parse(first.args[0])) !== canonical({ ...previousFields, contact_requested: 'Yes' })
          || canonical(JSON.parse(first.args[1])) !== canonical(previousRestricted)
          || list.length !== 3 || !list[2].sql.trim().startsWith('INSERT INTO followup')
          || list[2].args[0] !== plan.owner || list[2].args[1] !== `${plan.owner}:${plan.revision + 1}`) fail();
      const ticket = crypto.randomUUID();
      // INSERT is the one-use claim. Duplicate/ambiguous claims never run injection.
      const claim = await db.prepare(`INSERT INTO profile_qualification_operation
        (id, owner, revision, scenario, ticket, phase, before_json, outcome)
        VALUES (?, ?, ?, ?, ?, 'claimed', ?, 'UNKNOWN_NO_REPLAY')`)
        .bind(plan.id, plan.owner, plan.revision, plan.scenario, ticket, canonical(witness)).run();
      if (!good(claim, 1)) fail();
      await phase(db, plan, ticket, 'claimed');
      try {
        if (plan.scenario === 'audit') {
          const results = await db.batch([
            ddlGuard(db, plan, ticket, 'claimed', false),
            db.prepare(AUDIT_TRIGGER_SQL),
            db.prepare("UPDATE profile_qualification_operation SET phase = 'injected' WHERE id = ? AND ticket = ? AND phase = 'claimed'").bind(plan.id, ticket),
          ]);
          if (!allGood(results) || results.length !== 3 || !good(results[2], 1)) fail();
          await phase(db, plan, ticket, 'injected');
          if (!exactTrigger(await trigger(db))) fail();
        } else {
          const args = [], guard = predicate(before, args); args.push(plan.id, ticket, plan.owner, plan.revision);
          const results = await db.batch([
            db.prepare(`UPDATE caregiver SET status = 'archived' WHERE ${guard}
              AND EXISTS (SELECT 1 FROM profile_qualification_operation WHERE id = ? AND ticket = ? AND phase = 'claimed')
              AND COALESCE((SELECT revision FROM caregiver_profile WHERE caregiver_id = ?), 0) = ?`).bind(...args),
            db.prepare("UPDATE profile_qualification_operation SET phase = 'injected' WHERE id = ? AND ticket = ? AND phase = 'claimed' AND changes() = 1").bind(plan.id, ticket),
          ]);
          if (!allGood(results) || results.length !== 2 || !good(results[0], 1) || !good(results[1], 1)) fail();
          await phase(db, plan, ticket, 'injected');
        }
        // Injection acknowledgement must be known before dispatch. A lost ack
        // jumps to finally, reconciles cleanup, and NEVER calls the product batch.
        const result = await db.batch(list.map(s => s.native));
        if (!allGood(result) || result.length !== list.length || result.some(r => r.meta.changes !== 0)) fail();
        const saved = await db.prepare("UPDATE profile_qualification_operation SET outcome = 'NO_WRITE_ACKNOWLEDGED' WHERE id = ? AND ticket = ? AND phase = 'injected'").bind(plan.id, ticket).run();
        if (!good(saved, 1)) fail();
        return result;
      } finally {
        // Failed cleanup is a hard stop with durable injected/UNKNOWN state.
        await recoverProfileFault(db, plan);
      }
    },
  };
}
