// POST /api/intake — the single form-intake endpoint (slice 03).
// All three site forms post here with a `kind` field; slice 04 wires them up.
import { handleIntake, checkIpRequestLimit, IP_LIMITS } from './_shared.mjs';
import { confirmSupportGroup } from '../_lib/registration-email.mjs';
import { isSupportGroup } from '../_lib/support-group-session.mjs';

export async function onRequestPost({ request, env }) {
  const limited = await checkIpRequestLimit(env.LEGACY_DB, request, IP_LIMITS.intake);
  if (!limited.ok) return json({ ok: false, error: limited.error }, limited.status);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid JSON' }, 400);
  }
  const result = await handleIntake(env.LEGACY_DB, body);
  // Support-group sign-ups only (approved Nov 1). Ordinary event registrations deliberately
  // have no confirmation email in this release.
  if (isSupportGroup(body) && result.body.ok) {
    result.body.confirmation_email = await confirmSupportGroup(env, body, result.status === 201);
  }
  return json(result.body, result.status);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
