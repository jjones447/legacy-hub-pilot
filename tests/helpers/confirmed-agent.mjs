// INERT TEST SUPPORT ONLY. Models verified middleware context and a browser's retained
// receipt for old application tests. Decoding synthetic headers here is NOT auth proof.
import { onRequestPost } from '../../functions/api/agent/[[path]].js';
import { confirmationBinding, setVerifiedAccessStaffActor } from '../../functions/_lib/agent-confirmation.mjs';
const receipts = new WeakMap();
function receiptMap(db) { if (!receipts.has(db)) receipts.set(db, new Map()); return receipts.get(db); }
export async function captureSeededPreview(env, kind, id, origin = 'http://localhost') {
  const row = await env.LEGACY_DB.prepare(`SELECT * FROM ${kind === 'content' ? 'content_item' : 'agent_change'} WHERE id = ?`).bind(id).first();
  if (!row) return null;
  const receipt = await confirmationBinding(env.LEGACY_DB, kind, row, origin);
  receiptMap(env.LEGACY_DB).set(id, receipt.version);
  return receipt.version;
}
export async function postAgentFixture({ request, env }) {
  const url = new URL(request.url);
  const body = await request.clone().json().catch(() => ({}));
  let actor = request.headers.get('x-dev-actor') || 'staff@example.org';
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (jwt) actor = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).email || null;
  if (url.pathname.endsWith('/confirm') || url.pathname.endsWith('/discard')) {
    const id = body.draft_id || body.change_id;
    if (id && body.preview_version === undefined) {
      body.preview_version = receiptMap(env.LEGACY_DB).get(id)
        || await captureSeededPreview(env, body.draft_id ? 'content' : 'workflow', id, url.origin);
      request = new Request(request, { body: JSON.stringify(body) });
    }
  }
  const data = {};
  setVerifiedAccessStaffActor(data, actor); // Explicit fictional middleware fixture, never production authentication.
  const response = await onRequestPost({ request, env, data });
  if (url.pathname.endsWith('/draft')) {
    const reply = await response.clone().json();
    if (reply.draft_id || reply.change_id) receiptMap(env.LEGACY_DB).set(reply.draft_id || reply.change_id, reply.preview_version);
  }
  return response;
}
