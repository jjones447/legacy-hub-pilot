// POST /api/intake — the single form-intake endpoint (slice 03).
// All three site forms post here with a `kind` field; slice 04 wires them up.
import { handleIntake } from './_shared.mjs';

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid JSON' }, 400);
  }
  const result = await handleIntake(env.LEGACY_DB, body);
  return json(result.body, result.status);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
