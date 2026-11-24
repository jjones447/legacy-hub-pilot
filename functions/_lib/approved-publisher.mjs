import { publisherActor } from './publisher-identity.mjs';
import { PUBLISHER_APPROVALS } from './publisher-approvals.mjs';
import { confirmationBinding, confirmationAudit } from './agent-confirmation.mjs';
import { _resetContentCache, findDisallowedHtml } from '../_content.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
const canonical = value => JSON.stringify(sort(value));
function sort(v) {
  if (Array.isArray(v)) return v.map(sort);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])]));
  return v;
}
// Full persisted target version, including data, owner and timestamps. A content-only
// hash would miss an intervening edit that happens to restore the same paragraph.
export async function publisherTargetVersion(target) {
  const bytes = new TextEncoder().encode(canonical(target));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
const owner = (actor, entry) => 'access_publisher:' + canonical({ actor, ...entry });
const qualified = entry => entry && /^[a-zA-Z0-9_-]{1,100}$/.test(entry.operation_id || '')
  && ['preview', 'production'].includes(entry.environment)
  && typeof entry.origin === 'string' && /^https:\/\//.test(entry.origin)
  && (() => { try { return new URL(entry.origin).origin === entry.origin; } catch { return false; } })()
  && /^[a-f0-9]{64}$/.test(entry.target_version || '');
function snapshotCondition(target) {
  const fields = Object.keys(target);
  if (!fields.every(k => /^[a-z_][a-z0-9_]*$/.test(k))) throw new Error('invalid snapshot');
  return { sql: fields.map(k => `"${k}" IS ?`).join(' AND '), params: fields.map(k => target[k]) };
}
// Trusted server construction only: neither request bodies nor environment variables
// may supply a catalog. Tests construct an isolated synthetic catalog here.
export function createApprovedPublisher(catalog) {
  const entries = JSON.parse(JSON.stringify(catalog));
  const approval = (ref, target) => entries.find(a => a.approval_ref === ref && a.target_id === target);
  const inScope = (entry, env, url) => qualified(entry)
    && entry.environment === env.ENVIRONMENT && entry.origin === url.origin;
  function draftApproval(draft, actor) {
    try {
      const stored = JSON.parse(draft.updated_by.slice('access_publisher:'.length));
      const entry = approval(stored.approval_ref, draft.draft_of);
      return entry && draft.updated_by === owner(actor, entry) ? entry : null;
    } catch { return null; }
  }
  const operationDraftId = async entry => 'cid_pub_' + await publisherTargetVersion(entry.operation_id);
  async function receipt(db, entry, actor, id) {
    const draft = await db.prepare('SELECT * FROM content_item WHERE id = ?').bind(id).first();
    const audit = await db.prepare(`SELECT id,after_json FROM audit_log
      WHERE actor=? AND action='content_item.publish' AND entity='content_item'
      AND entity_id=? AND json_extract(after_json,'$.publisher_operation')=? ORDER BY id LIMIT 1`)
      .bind(actor, entry.target_id, entry.operation_id).first();
    if (audit) {
      const after = JSON.parse(audit.after_json);
      return { operation_id: entry.operation_id, draft_id: id,
        state: after.publisher_binding === owner(actor, entry) && after.draft_id === id ? 'published' : 'conflict',
        audit_id: audit.id };
    }
    return { operation_id: entry.operation_id, draft_id: id,
      state: !draft ? 'absent' : draft.updated_by === owner(actor, entry) && draft.status === 'draft' ? 'draft' : 'conflict' };
  }
  return async function handleApprovedPublisher({ request, env, data }) {
    const actor = publisherActor(data);
    if (!actor) return json({ ok: false, error: 'verified publisher required' }, 403);
    const url = new URL(request.url);
    const action = url.pathname.split('/').pop();
    if (request.method !== 'POST' || !['draft', 'preview', 'confirm', 'status'].includes(action)) return json({ ok: false }, 405);
    // Machine calls need no browser Origin, but any supplied origin must match exactly.
    if (request.headers.has('Origin') && request.headers.get('Origin') !== url.origin) return json({ ok: false }, 403);
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) return json({ ok: false }, 415);
    const chunks = [];
    let length = 0;
    if (request.body) {
      const reader = request.body.getReader();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 16384) { await reader.cancel(); return json({ ok: false }, 413); }
        chunks.push(chunk.value);
      }
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const raw = new TextDecoder().decode(bytes);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ ok: false }, 400); }
    if (!body || Array.isArray(body) || typeof body !== 'object') return json({ ok: false }, 400);
    const allowed = action === 'status' ? ['approval_ref', 'target_id'] : action === 'draft' ? ['approval_ref', 'target_id', 'changes']
      : action === 'confirm' ? ['approval_ref', 'draft_id', 'preview_version'] : ['approval_ref', 'draft_id'];
    if (Object.keys(body).some(k => !allowed.includes(k))) return json({ ok: false, error: 'unsupported field' }, 400);
    const db = env.LEGACY_DB;
    try {
      if (action === 'status') {
        const entry = approval(body.approval_ref, body.target_id);
        if (!inScope(entry, env, url)) return json({ ok: false }, 403);
        return json({ ok: true, ...await receipt(db, entry, actor, await operationDraftId(entry)) });
      }
      if (action === 'draft') {
        const entry = approval(body.approval_ref, body.target_id);
        if (!inScope(entry, env, url) || canonical(body.changes) !== canonical(entry.changes)) {
          return json({ ok: false, error: 'recorded approval does not authorize this target/value' }, 403);
        }
        const id = await operationDraftId(entry);
        const existing = await receipt(db, entry, actor, id);
        if (existing.state !== 'absent') return json({ ok: false, error: 'reconcile original operation', ...existing }, 409);
        if (findDisallowedHtml(entry.changes)) return json({ ok: false }, 400);
        const target = await db.prepare('SELECT * FROM content_item WHERE id = ?').bind(entry.target_id).first();
        if (!target || target.type_id !== entry.type_id || target.status !== 'published') return json({ ok: false }, 409);
        if (await publisherTargetVersion(target) !== entry.target_version) return json({ ok: false, error: 'approved target version changed' }, 409);
        const prior = JSON.parse(target.data);
        const after = { ...prior, ...entry.changes };
        const snapshot = snapshotCondition(target);
        // Deterministic PRIMARY KEY is the one-operation reservation. No REPLACE/upsert:
        // concurrent duplicate drafts cannot each gain publication authority. Retain the
        // archived row after publish. Append-only audit also fences reuse if it is absent.
        await db.prepare(`INSERT INTO content_item (id,type_id,data,status,draft_of,updated_by,updated_at)
          SELECT ?,?,?,'draft',?,?,datetime('now')
          WHERE EXISTS (SELECT 1 FROM content_item WHERE ${snapshot.sql})
          AND NOT EXISTS (SELECT 1 FROM audit_log WHERE actor=? AND action='content_item.publish'
            AND entity='content_item' AND entity_id=? AND json_extract(after_json,'$.publisher_operation')=?)`)
          .bind(id, entry.type_id, JSON.stringify(after), target.id, owner(actor, entry),
            ...snapshot.params, actor, entry.target_id, entry.operation_id).run();
        const reserved = await receipt(db, entry, actor, id);
        if (reserved.state !== 'draft') return json({ ok: false, error: 'operation reservation refused', ...reserved }, 409);
        return json({ ok: true, ...reserved, approval_ref: entry.approval_ref });
      }
      const draft = typeof body.draft_id === 'string'
        ? await db.prepare('SELECT * FROM content_item WHERE id = ?').bind(body.draft_id).first() : null;
      if (!draft || draft.status !== 'draft' || !String(draft.updated_by).startsWith('access_publisher:')) return json({ ok: false }, 409);
      const entry = draftApproval(draft, actor);
      if (!inScope(entry, env, url) || body.approval_ref !== entry.approval_ref) return json({ ok: false }, 403);
      if (draft.id !== await operationDraftId(entry)) return json({ ok: false }, 409);
      const binding = await confirmationBinding(db, 'content', draft, url.origin);
      const target = binding.target;
      if (!target || target.status !== 'published' || target.type_id !== entry.type_id) return json({ ok: false }, 409);
      if (await publisherTargetVersion(target) !== entry.target_version) return json({ ok: false, error: 'approved target version changed' }, 409);
      const prior = JSON.parse(target.data), after = JSON.parse(draft.data);
      if (canonical(after) !== canonical({ ...prior, ...entry.changes })) return json({ ok: false }, 409);
      if (action === 'preview') return json({
        ok: true, draft_id: draft.id, approval_ref: entry.approval_ref,
        preview_version: binding.version, before: prior, after,
      });
      if (typeof body.preview_version !== 'string' || body.preview_version !== binding.version) return json({ ok: false }, 409);
      await db.batch([
        confirmationAudit(db, binding, actor, 'content_item.publish', 'content_item', target.id,
          { status: target.status, data: prior },
          { status: 'published', data: after, approval_ref: entry.approval_ref, publisher_operation: entry.operation_id, publisher_binding: owner(actor, entry), draft_id: draft.id }),
        db.prepare(`UPDATE content_item SET data=?,updated_by=?,updated_at=datetime('now') WHERE id=?`)
          .bind(draft.data, actor, target.id),
        db.prepare(`UPDATE content_item SET status='archived',updated_at=datetime('now') WHERE id=?`).bind(draft.id),
      ]);
      _resetContentCache();
      return json({ ok: true, target_id: target.id, approval_ref: entry.approval_ref });
    } catch { return json({ ok: false, error: 'publisher operation failed; reconcile before retry' }, 409); }
  };
}
export const approvedPublisher = createApprovedPublisher(PUBLISHER_APPROVALS);
