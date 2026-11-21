// Synthetic, in-memory SQLite only; never provider/native D1 or real login mail.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequestGet, onRequestPost } from '../../functions/api/portal/[[path]].js';
import { onRequestGet as staffGet } from '../../functions/api/staff/[[path]].js';
import { setVerifiedAccessStaffActor } from '../../functions/_lib/agent-confirmation.mjs';

export const ORIGIN = 'https://profile.synthetic.invalid';
const SECRET = 'synthetic-profile-signing-key';
export async function cookie(id = 'cg_a', expires = Date.now() + 60000) {
  const payload = `${id}:${expires}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`session:${payload}`));
  return `portal_session=${encodeURIComponent(`${payload}:${Buffer.from(signature).toString('hex')}`)}`;
}
export function fixture(options = {}) {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  for (const name of ['0001_init.sql', '0011_staff_member.sql', 'candidates/0022_caregiver_profile.sql']) {
    raw.exec(readFileSync(new URL(`../../schema/${name}`, import.meta.url), 'utf8'));
  }
  raw.exec(`DELETE FROM staff_member;
    INSERT INTO staff_member(email, role) VALUES ('admin@example.invalid', 'admin'), ('staff@example.invalid', 'staff')`);
  raw.exec(`INSERT INTO caregiver(id, first_name, email, phone) VALUES
    ('cg_a', 'Fictional A', 'fictional.a@example.invalid', '414-555-0100'),
    ('cg_b', 'Fictional B', 'fictional.b@example.invalid', '414-555-0101')`);
  const effects = { statements: [], batches: 0 };
  const db = {
    prepare(sql) {
      effects.statements.push(sql);
      const bind = (...args) => ({
        async first() { options.beforeRead?.(raw, sql); return raw.prepare(sql).get(...args) ?? null; },
        async run() { return { success: true, meta: raw.prepare(sql).run(...args) }; },
      });
      return { ...bind(), bind };
    },
    async batch(statements) {
      effects.batches++;
      await options.beforeBatch?.(raw);
      raw.exec('BEGIN');
      let results;
      try {
        results = [];
        for (const statement of statements) results.push(await statement.run());
        raw.exec('COMMIT');
      } catch (error) { raw.exec('ROLLBACK'); throw error; }
      if (options.lostAck) throw new Error('SYNTHETIC private lost ack');
      return options.unknownMeta ? [{}] : results;
    },
  };
  const env = { LEGACY_DB: db, PORTAL_TOKEN_SECRET: SECRET, PORTAL_PROFILE_ENABLED: '1' };
  async function call({ method = 'GET', body, id = 'cg_a', headers = {}, path = '/api/portal/profile', rawBody } = {}) {
    const h = new Headers({ Origin: ORIGIN, 'Content-Type': 'application/json', Cookie: await cookie(id), ...headers });
    for (const [name, value] of Object.entries(headers)) if (value === null) h.delete(name);
    const request = new Request(ORIGIN + path, { method, headers: h,
      ...(method === 'POST' ? { body: rawBody ?? JSON.stringify(body) } : {}) });
    return (method === 'POST' ? onRequestPost : onRequestGet)({ request, env });
  }
  async function staffCall(path = '/api/staff/caregiver-profile/cg_a', { actor = 'staff@example.invalid', verified = true, headers = {} } = {}) {
    const data = { agentStaffActor: actor };
    if (verified) setVerifiedAccessStaffActor(data, actor);
    return staffGet({ request: new Request(ORIGIN + path, { headers }), env, data });
  }
  return { raw, db, env, effects, call, staffCall, close: () => raw.close() };
}
