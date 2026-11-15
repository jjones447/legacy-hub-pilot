// POST /api/unsubscribe — leave the email list with the token from your own link (schema/0020).
// Public by design, like /api/intake: the 128-bit token is the only credential. Known and
// unknown tokens get the same answer, repeats are harmless, and the token is never logged
// or echoed back.
import { checkIpRequestLimit, IP_LIMITS } from './_shared.mjs';
import { handleUnsubscribe } from '../_lib/newsletter.mjs';
import { internalError } from '../_lib/errors.js';

export async function onRequestPost({ request, env }) {
  const limited = await checkIpRequestLimit(env.LEGACY_DB, request, IP_LIMITS.unsubscribe);
  if (!limited.ok) return json({ ok: false, error: limited.error }, limited.status);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid JSON' }, 400);
  }
  try {
    const result = await handleUnsubscribe(env.LEGACY_DB, body);
    return json(result.body, result.status);
  } catch (e) {
    return internalError('/api/unsubscribe POST', e);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
