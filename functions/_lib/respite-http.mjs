import { confirmationActor } from './agent-confirmation.mjs';
import { matchesSupportSession, supportSessionProof } from './support-session-proof.mjs';
import { readSupportRequestBody } from './portal-support-request-http.mjs';
import { currentRespiteAckVersions, readRespiteAckVersions } from './respite-acknowledgments.mjs';
import { createRespiteParticipant } from './respite-participant-store.mjs';
import { createPendingRespiteRequest, validatePendingRespiteCreate } from './respite-pending-store.mjs';
import { respiteSchemaIsReady } from './respite-schema.mjs';
import { setRespiteStaffEligibility } from './respite-staff-grant.mjs';
import { readOwnerRespiteEligibility, readOwnerRespiteView, readStaffPendingRespiteRequests } from './respite-views.mjs';

const ownerPath = '/api/portal/respite';
const staffPath = '/api/staff/respite';
const sessionScope = 'respite-session-v1';
const sessionHeader = 'X-Respite-Session';
const acknowledgmentHeader = 'X-Respite-Acknowledgments';
const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'},
});
const error = (code, status) => reply({ok: false, error: code}, status);

export function isRespitePath(path, role) {
  const root = role === 'staff' ? staffPath : ownerPath;
  return path === root || path.startsWith(root + '/');
}

export function isRespiteTestOrigin(url, env) {
  return env.ENVIRONMENT === 'preview' && env.PORTAL_RESPITE_TEST_ENABLED === '1'
    && /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+\.pages\.dev$/.test(url.origin)
    && typeof env.PORTAL_RESPITE_TEST_ORIGIN === 'string'
    && env.PORTAL_RESPITE_TEST_ORIGIN.split(',').includes(url.origin);
}

async function fixtureOwner(db, id) {
  if (typeof id !== 'string' || !/^[-A-Za-z0-9_]{1,160}$/.test(id)) return false;
  const row = await db.prepare(`SELECT id FROM caregiver WHERE id=? AND status='active'
    AND (SELECT COUNT(DISTINCT value) FROM json_each(
      CASE WHEN json_valid(segment_tags) AND json_type(segment_tags)='array' THEN segment_tags ELSE '[]' END
    ) WHERE type='text' AND value IN ('qa_test','exclude_reporting'))=2`).bind(id).first();
  return row?.id === id;
}

function acknowledgmentScope() {
  const {privacy, nonmedical} = readRespiteAckVersions();
  return JSON.stringify(['respite-ack-v1', privacy, nonmedical]);
}

function respond(result, created = false) {
  if (result.ok) return reply(result, created && !result.replayed ? 201 : 200);
  const statuses = {
    invalid_command: 400, invalid_request: 400, invalid_details: 422, unauthorized: 401,
    forbidden: 403, conflict: 409, stale_or_forbidden: 409, idempotency_conflict: 409,
    new_acknowledgment_required: 409, details_unavailable: 422, outcome_unknown: 503,
  };
  return reply(result, statuses[result.error] ?? 503);
}

export async function respiteRequest({request, env, data, readOwnerSession}) {
  const url = new URL(request.url);
  const staff = isRespitePath(url.pathname, 'staff');
  const root = staff ? staffPath : ownerPath;
  const routes = staff
    ? {'/session': ['GET'], '': ['GET'], '/eligibility': ['GET', 'POST']}
    : {'/session': ['GET'], '': ['GET'], '/participant': ['POST'], '/request': ['POST']};
  const path = url.pathname.slice(root.length);
  if (!isRespiteTestOrigin(url, env) || url.search || !Object.hasOwn(routes, path)) return error('not_found', 404);
  if (!routes[path].includes(request.method)) return error('method_not_allowed', 405);
  const write = request.method === 'POST';
  if (write && request.headers.get('Origin') !== url.origin) return error('forbidden', 403);
  if (write && request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return error('invalid_content_type', 415);
  }

  try {
    const role = staff ? 'staff' : 'owner';
    const db = env.LEGACY_DB;
    const ownerId = env.PORTAL_RESPITE_TEST_CAREGIVER_ID;
    let principal;
    if (staff) {
      principal = confirmationActor(data);
      if (!principal || principal !== env.PORTAL_RESPITE_TEST_STAFF_EMAIL) return error('forbidden', 403);
      const member = await db.prepare(`SELECT email FROM staff_member WHERE email=?
        AND status='active' AND role IN ('staff','admin')`).bind(principal).first();
      if (member?.email !== principal) return error('forbidden', 403);
    } else {
      principal = await readOwnerSession();
      if (!principal) return error('unauthorized', 401);
      if (principal !== ownerId) return error('forbidden', 403);
    }

    if (path !== '/session' && !await matchesSupportSession(request, role, principal, sessionScope, sessionHeader)) {
      return error('session_changed', 403);
    }
    if (!await fixtureOwner(db, ownerId)) return error('forbidden', 403);
    if (!await respiteSchemaIsReady(db)) return error('unavailable', 503);

    if (path === '/session') {
      const eligibility = staff ? {ok: true, visible: true} : await readOwnerRespiteEligibility(db, ownerId);
      if (!eligibility.ok) return respond(eligibility);
      const proof = await supportSessionProof(request, role, principal, sessionScope);
      return proof ? reply({ok: true, principal, proof, visible: eligibility.visible}) : error('forbidden', 403);
    }
    if (staff) {
      if (path === '') return respond(await readStaffPendingRespiteRequests(db, principal, ownerId));
      if (!write) {
        const grant = await db.prepare('SELECT enabled,revision FROM respite_staff_eligibility WHERE caregiver_id=?')
          .bind(ownerId).first();
        return reply({ok: true, enabled: grant?.enabled === 1, revision: grant?.revision ?? 0});
      }
      const body = await readSupportRequestBody(request);
      if (!body || body.caregiver_id !== ownerId) return error('invalid_command', 400);
      return respond(await setRespiteStaffEligibility(db, principal, body));
    }
    if (path === '') {
      const view = await readOwnerRespiteView(db, ownerId);
      if (!view.ok || !view.visible) return respond(view);
      const proof = await supportSessionProof(request, role, principal, acknowledgmentScope());
      return proof ? reply({...view, acknowledgment_proof: proof}) : error('forbidden', 403);
    }
    if (path === '/participant') {
      const eligibility = await readOwnerRespiteEligibility(db, ownerId);
      if (!eligibility.ok) return respond(eligibility);
      if (!eligibility.visible) return error('forbidden', 403);
      return respond(await createRespiteParticipant(db, ownerId, await readSupportRequestBody(request, 32768)), true);
    }
    const body = validatePendingRespiteCreate(await readSupportRequestBody(request));
    if (!body) return error('invalid_request', 400);
    if (!currentRespiteAckVersions(body.acknowledgment_versions)
      || !await matchesSupportSession(request, role, principal, acknowledgmentScope(), acknowledgmentHeader)) {
      return error('new_acknowledgment_required', 409);
    }
    return respond(await createPendingRespiteRequest(db, ownerId, body), true);
  } catch {
    return error('unavailable', 503);
  }
}
