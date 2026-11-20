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
function approval(ref, target) {
  return PUBLISHER_APPROVALS.find(a => a.approval_ref === ref && a.target_id === target);
}
const owner = (actor, entry) => 'access_publisher:' + JSON.stringify({
  actor, approval_ref: entry.approval_ref, target_id: entry.target_id,
});
function draftApproval(draft, actor) {
  try {
    const stored = JSON.parse(draft.updated_by.slice('access_publisher:'.length));
    const entry = approval(stored.approval_ref, draft.draft_of);
    return entry && draft.updated_by === owner(actor, entry) ? entry : null;
  } catch { return null; }
}
export async function approvedPublisher({ request, env, data }) {
  const actor = publisherActor(data);
  if (!actor) return json({ ok: false, error: 'verified publisher required' }, 403);
  const url = new URL(request.url);
  const action = url.pathname.split('/').pop();
  if (request.method !== 'POST' || !['draft', 'preview', 'confirm'].includes(action)) return json({ ok: false }, 405);
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
  const allowed = action === 'draft' ? ['approval_ref', 'target_id', 'changes']
    : action === 'confirm' ? ['approval_ref', 'draft_id', 'preview_version'] : ['approval_ref', 'draft_id'];
  if (Object.keys(body).some(k => !allowed.includes(k))) return json({ ok: false, error: 'unsupported field' }, 400);
  const db = env.LEGACY_DB;
  try {
    if (action === 'draft') {
      const entry = approval(body.approval_ref, body.target_id);
      if (!entry || canonical(body.changes) !== canonical(entry.changes)) {
        return json({ ok: false, error: 'recorded approval does not authorize this target/value' }, 403);
      }
      if (findDisallowedHtml(entry.changes)) return json({ ok: false }, 400);
      const target = await db.prepare('SELECT * FROM content_item WHERE id = ?').bind(entry.target_id).first();
      if (!target || target.type_id !== entry.type_id || target.status !== 'published') return json({ ok: false }, 409);
      const prior = JSON.parse(target.data);
      const after = { ...prior, ...entry.changes };
      const id = 'cid_pub_' + crypto.randomUUID();
      await db.prepare(`INSERT INTO content_item (id,type_id,data,status,draft_of,updated_by,updated_at)
        VALUES (?,?,?,'draft',?,?,datetime('now'))`)
        .bind(id, entry.type_id, JSON.stringify(after), target.id, owner(actor, entry)).run();
      return json({ ok: true, draft_id: id, approval_ref: entry.approval_ref });
    }
    const draft = typeof body.draft_id === 'string'
      ? await db.prepare('SELECT * FROM content_item WHERE id = ?').bind(body.draft_id).first() : null;
    if (!draft || draft.status !== 'draft' || !String(draft.updated_by).startsWith('access_publisher:')) return json({ ok: false }, 409);
    const entry = draftApproval(draft, actor);
    if (!entry || body.approval_ref !== entry.approval_ref) return json({ ok: false }, 403);
    const binding = await confirmationBinding(db, 'content', draft, url.origin);
    const target = binding.target;
    if (!target || target.status !== 'published' || target.type_id !== entry.type_id) return json({ ok: false }, 409);
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
        { status: 'published', data: after, approval_ref: entry.approval_ref }),
      db.prepare(`UPDATE content_item SET data=?,updated_by=?,updated_at=datetime('now') WHERE id=?`)
        .bind(draft.data, actor, target.id),
      db.prepare(`UPDATE content_item SET status='archived',updated_at=datetime('now') WHERE id=?`).bind(draft.id),
    ]);
    _resetContentCache();
    return json({ ok: true, target_id: target.id, approval_ref: entry.approval_ref });
  } catch { return json({ ok: false, error: 'publisher operation failed; reconcile before retry' }, 409); }
}
