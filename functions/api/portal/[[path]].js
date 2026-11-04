// GET/POST /api/portal/[[path]] — Magic-link authentication and gated caregiver portal API endpoints (slice 09).
import { checkIpRequestLimit, IP_LIMITS } from '../_shared.mjs';
import { canSendEmail, isPreviewMailOptIn, sendEmail, signInEmail } from '../../_lib/email.js';
import { previewQACaregiver, matchesPreviewQACaregiver } from '../../_lib/portal-preview.mjs';
import { QUESTIONS, validateCheckin, recordCheckin, caregiverHistory, isCheckinDue, CHECKIN_EVERY_DAYS } from '../../_lib/wellness.js';
import { handlePortalSupport, handlePortalSupportGet } from '../../_lib/portal-support.js';

async function getHmacSha256(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign", "verify"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(message)
  );
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(text) {
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// Preview stays closed unless one configured QA identity is explicitly selected.
// The shared/fallback mail flag and retired dev-link flag cannot bypass this.
function previewPortalDisabled(env) {
  if (env.ENVIRONMENT === 'development') return true;
  if (env.ENVIRONMENT === 'preview') return !isPreviewMailOptIn(env);
  return false;
}

function previewUnavailable() {
  return json({ ok: false, error: 'preview_portal_disabled' }, 503);
}

// Match login/me's existing lifecycle contract, without fetching profile fields.
// This is a current-request check, not a revocation table or a transaction across
// subsequent history reads/writes. Binding failures propagate to the generic 500.
async function hasNonarchivedCaregiver(db, caregiverId, env) {
  if (!env || typeof env !== 'object') return false;
  if (typeof caregiverId !== 'string' || !caregiverId || caregiverId.length > 256) return false;
  if (env.ENVIRONMENT === 'preview') {
    const qa = previewQACaregiver(env);
    if (!qa || caregiverId !== qa.id) return false;
    const caregiver = await db.prepare(`SELECT id, email FROM caregiver WHERE id = ? AND status != 'archived'`)
      .bind(caregiverId).first();
    return matchesPreviewQACaregiver(env, caregiver?.id, caregiver?.email);
  }
  const caregiver = await db
    .prepare(`SELECT id FROM caregiver WHERE id = ? AND status != 'archived'`)
    .bind(caregiverId)
    .first();
  return caregiver?.id === caregiverId;
}

function previewAuthPrefix(env) {
  if (env.ENVIRONMENT !== 'preview') return '';
  const qa = previewQACaregiver(env);
  if (!qa) throw new Error('preview_auth_not_configured');
  return `preview-qa:${qa.id}:${qa.email}:`;
}

async function portalTokenHash(token, env) {
  const prefix = previewAuthPrefix(env);
  return sha256(prefix ? `${prefix}token:${token}` : token);
}

function sessionMessage(payload, env) {
  return `${previewAuthPrefix(env)}session:${payload}`;
}

const CLEARED_SESSION_COOKIE = 'portal_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
const CONFIRM_COOKIE = '__Host-portal_confirm';
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const CONFIRM_NONCE = /^[A-Za-z0-9_-]{43}$/;

function confirmationCookieNonce(request) {
  const values = (request.headers.get('Cookie') || '').split(';')
    .map(value => value.trim()).filter(value => value.startsWith(`${CONFIRM_COOKIE}=`));
  if (values.length !== 1) return null;
  const nonce = values[0].slice(CONFIRM_COOKIE.length + 1);
  return CONFIRM_NONCE.test(nonce) ? nonce : null;
}

function confirmationHeaders() {
  return {
    'content-type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    // Native form navigation with no-referrer can send Origin:null. Send ONLY
    // the origin (never this token-bearing path/query), retaining strict CSRF.
    'Referrer-Policy': 'strict-origin',
    'Content-Security-Policy': "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  };
}

async function confirmationPage(request, token, secret, env) {
  // GET/HEAD never read identity/token state, claim a token, audit a login or issue
  // a session. Only GET creates a short-lived, non-authentication browser nonce.
  if (request.method === 'HEAD') return new Response(null, { headers: confirmationHeaders() });
  const nonce = confirmationCookieNonce(request) || randomToken();
  const proof = await getHmacSha256(`portal-confirm:${await portalTokenHash(token, env)}:${nonce}`, secret);
  // Values are restricted to the opaque-token/base64url/hex alphabets before
  // interpolation. No script or auto-submit redeems a link on navigation.
  return new Response(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Continue to your portal</title><link rel="stylesheet" href="/styles.css"></head>
<body class="portal-error-body"><main class="portal-error-card">
<h1 class="portal-error-title">Continue to your portal</h1>
<p>Choose Continue to finish signing in. Opening this page does not sign you in.</p>
<form method="post" action="/api/portal/verify">
<input type="hidden" name="token" value="${token}">
<input type="hidden" name="csrf" value="${nonce}">
<input type="hidden" name="proof" value="${proof}">
<button type="submit" class="btn btn-plum">Continue</button>
</form></main></body></html>`, { headers: {
    ...confirmationHeaders(),
    'Set-Cookie': `${CONFIRM_COOKIE}=${nonce}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900`,
  } });
}

async function confirmationToken(request, secret, env) {
  const nonce = confirmationCookieNonce(request);
  if (!nonce || (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const form = new URLSearchParams(new TextDecoder().decode(bytes));
  if ([...form.keys()].sort().join(',') !== 'csrf,proof,token') return null;
  const token = form.get('token'), csrf = form.get('csrf'), proof = form.get('proof');
  if (!OPAQUE_TOKEN.test(token) || !CONFIRM_NONCE.test(csrf) || !/^[a-f0-9]{64}$/.test(proof)) return null;
  if (!constantTimeEqual(csrf, nonce)) return null;
  const expected = await getHmacSha256(`portal-confirm:${await portalTokenHash(token, env)}:${nonce}`, secret);
  return constantTimeEqual(proof, expected) ? token : null;
}

function htmlErrorPage(message) {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Portal Access Error</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="portal-error-body">
  <div class="portal-error-card">
    <h1 class="portal-error-title">Access Link Error</h1>
    <p class="portal-error-text">${message}</p>
    <a class="portal-error-link" href="/portal.html">Go to Login Page</a>
  </div>
</body>
</html>`, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    status: 400
  });
}

async function parseSessionCookie(cookieHeader, secret, env) {
  if (!env || typeof env !== 'object') return null;
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/portal_session=([^;]+)/);
  if (!match) return null;
  const sessionVal = decodeURIComponent(match[1]);
  const parts = sessionVal.split(':');
  if (parts.length !== 3) return null;
  const [caregiverId, exp, signature] = parts;
  // SEC-3: domain-separate session vs magic-link. A session cookie is signed over
  // `session:<payload>`; an opaque magic-link token pasted as a cookie is not an
  // `id:exp:session-hmac` value and cannot establish a session.
  if (env.ENVIRONMENT === 'preview' && caregiverId !== previewQACaregiver(env)?.id) return null;
  const computedSig = await getHmacSha256(sessionMessage(`${caregiverId}:${exp}`, env), secret);
  if (!constantTimeEqual(computedSig, signature)) return null;
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || Date.now() > expMs) return null;
  return caregiverId;
}

async function redeemToken(token, env, secret) {
  const tokenHash = await portalTokenHash(token, env);
  const tokenRow = await env.LEGACY_DB
    .prepare(`SELECT caregiver_id, used, expires_at FROM portal_token WHERE token_hash = ?`)
    .bind(tokenHash).first();
  if (!tokenRow) return htmlErrorPage('This access link is unrecognized or has been revoked.');
  if (tokenRow.used === 1) return htmlErrorPage('This access link has already been used.');
  const expiresAtMs = Date.parse(tokenRow.expires_at.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return htmlErrorPage('This access link has expired (15-minute limit).');
  const caregiverId = tokenRow.caregiver_id;
  if (!await hasNonarchivedCaregiver(env.LEGACY_DB, caregiverId, env)) return htmlErrorPage('This access link is unrecognized or has been revoked.');
  // Preserve the exact one-winner claim and current identity fence. Ambiguous
  // commit metadata remains fail-closed; never reset used after an unknown save.
  const qa = previewQACaregiver(env);
  const claimSql = `UPDATE portal_token SET used = 1 WHERE token_hash = ? AND used = 0 AND caregiver_id = ?
                  AND EXISTS (SELECT 1 FROM caregiver WHERE id = portal_token.caregiver_id AND status != 'archived'${qa ? ' AND LOWER(TRIM(email)) = ?' : ''})`;
  const claim = await env.LEGACY_DB.prepare(claimSql)
    .bind(tokenHash, caregiverId, ...(qa ? [qa.email] : [])).run();
  if (!claim || claim.success === false || !claim.meta || claim.meta.changes !== 1) return htmlErrorPage('This access link is unavailable or has already been used.');
  // This audit is still awaited before session issuance. A post-claim failure
  // consumes the token without a session; do not turn that uncertainty into reuse.
  await env.LEGACY_DB
    .prepare(`INSERT INTO audit_log (actor, action, entity, entity_id) VALUES (?, 'portal.login_success', 'caregiver', ?)`)
    .bind(caregiverId, caregiverId).run();
  const sessionExp = Date.now() + 2 * 60 * 60 * 1000;
  const sessionPayload = `${caregiverId}:${sessionExp}`;
  const sessionSig = await getHmacSha256(sessionMessage(sessionPayload, env), secret);
  const cookieValue = encodeURIComponent(`${sessionPayload}:${sessionSig}`);
  return new Response(null, { status: 302, headers: {
    'Cache-Control': 'no-store', 'Location': '/portal.html',
    'Set-Cookie': `portal_session=${cookieValue}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7200`,
  } });
}

export async function onRequestHead(context) {
  const response = await onRequestGet(context);
  return new Response(null, { status: response.status, headers: response.headers });
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const action = pathSegments[pathSegments.length - 1];

    // Before secret, token, cookie or database access: existing preview bearer
    // credentials must not unlock caregiver records after this containment.
    if (previewPortalDisabled(env)) return previewUnavailable();

    const secret = env.PORTAL_TOKEN_SECRET;
    if (!secret) {
      return json({ ok: false, error: 'auth_not_configured' }, 503);
    }

    if (action === 'verify') {
      const token = url.searchParams.get('token');
      if (!token) {
        return htmlErrorPage('Missing verification token.');
      }
      if (url.searchParams.getAll('token').length !== 1 || !OPAQUE_TOKEN.test(token)) return htmlErrorPage('This access link is unrecognized or has been revoked.');
      return await confirmationPage(request, token, secret, env);
    }

    if (action === 'me') {
      const caregiverId = await parseSessionCookie(request.headers.get('Cookie'), secret, env);
      if (!caregiverId) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }

      if (env.ENVIRONMENT === 'preview' && !await hasNonarchivedCaregiver(env.LEGACY_DB, caregiverId, env)) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }

      // Get profile
      const profile = await env.LEGACY_DB
        .prepare(`SELECT id, first_name, last_name, email, phone, sanctuary_member, member_since FROM caregiver WHERE id = ? AND status != 'archived'`)
        .bind(caregiverId)
        .first();

      if (!profile) {
        return json({ ok: false, error: 'profile_not_found' }, 404);
      }

      // Get grants
      const { results: grants } = await env.LEGACY_DB
        .prepare(`SELECT ga.id, ga.requested_for, ga.status, ga.created_at, aw.amount, aw.care_package, aw.outcome 
                  FROM grant_application ga 
                  LEFT JOIN award aw ON ga.id = aw.grant_application_id 
                  WHERE ga.caregiver_id = ? ORDER BY ga.created_at DESC, ga.id DESC`)
        .bind(caregiverId)
        .all();

      // Get events
      const { results: events } = await env.LEGACY_DB
        .prepare(`SELECT e.id, e.title, e.type, e.starts_at, e.location, r.status AS registration_status 
                  FROM registration r 
                  JOIN event e ON r.event_id = e.id 
                  WHERE r.caregiver_id = ? AND r.status != 'cancelled' AND e.publish_state = 'published'`)
        .bind(caregiverId)
        .all();

      return json({
        ok: true,
        profile,
        grants,
        events
      });
    }

    if (action === 'wellness') {
      // GET /api/portal/wellness -- the signed-in caregiver's own check-ins, whether one is due,
      // and the questions to ask.
      const caregiverId = await parseSessionCookie(request.headers.get('Cookie'), secret, env);
      if (!caregiverId) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      if (!await hasNonarchivedCaregiver(env.LEGACY_DB, caregiverId, env)) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      const history = await caregiverHistory(env.LEGACY_DB, caregiverId);
      const latest = history.length ? history[history.length - 1].created_at : null;
      return json({ ok: true, history, due: isCheckinDue(latest), every_days: CHECKIN_EVERY_DAYS, questions: QUESTIONS });
    }

    if (action === 'support' && pathSegments.length === 3) {
      const cookie = request.headers.get('Cookie') || '';
      const sessions = [...cookie.matchAll(/(?:^|;\s*)portal_session=([^;]*)/g)];
      let caregiverId = null;
      if (cookie.length <= 4096 && sessions.length === 1) {
        try {
          caregiverId = await parseSessionCookie(`portal_session=${sessions[0][1]}`, secret, env);
        } catch {
          caregiverId = null;
        }
      }
      if (!caregiverId) return json({ ok: false, error: 'unauthorized' }, 401);
      if (env.ENVIRONMENT === 'preview' && !await hasNonarchivedCaregiver(env.LEGACY_DB, caregiverId, env)) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      return await handlePortalSupportGet(request, env.LEGACY_DB, caregiverId);
    }

    return json({ ok: false, error: 'not_found' }, 404);
  } catch (e) {
    console.error('portal handler error:', e instanceof Error ? e.name : typeof e);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const action = pathSegments[pathSegments.length - 1];

    if (previewPortalDisabled(env)) {
      // Allow local cookie clearing without resolving the old preview identity,
      // consulting the database or relying on a configured signing secret.
      if (action === 'logout') {
        const response = json({ ok: true });
        response.headers.set('Set-Cookie', CLEARED_SESSION_COOKIE);
        return response;
      }
      return previewUnavailable();
    }

    // Incremental browser-origin defense for known production POST actions.
    // Compare the literal serialized value, never parse/refine a supplied origin.
    // Actual header absence preserves transport compatibility, NOT CSRF closure.
    if (action === 'login' || action === 'wellness' || action === 'logout') {
      const origin = request.headers.get('Origin');
      if (origin !== null && (origin === 'null' || origin !== url.origin)) {
        return json({ ok: false, error: 'forbidden' }, 403);
      }
    }
    // Confirmation and My Support are deliberate browser-only POSTs: absence, null,
    // duplicates and off-origin spellings all refuse BEFORE body/cookie/store access.
    if (action === 'verify' || action === 'support') {
      const origin = request.headers.get('Origin');
      if (origin === null || origin === 'null' || origin !== url.origin) {
        return json({ ok: false, error: 'forbidden' }, 403);
      }
    }

    const secret = env.PORTAL_TOKEN_SECRET;
    if (!secret) {
      return json({ ok: false, error: 'auth_not_configured' }, 503);
    }

    if (action === 'support' && pathSegments.length === 3) {
      // Keep this bounded slice separate from login, wellness and public intake.
      // Only an exact, single portal_session cookie may establish its owner.
      const cookie = request.headers.get('Cookie') || '';
      const sessions = [...cookie.matchAll(/(?:^|;\s*)portal_session=([^;]*)/g)];
      let caregiverId = null;
      if (cookie.length <= 4096 && sessions.length === 1) {
        try {
          caregiverId = await parseSessionCookie(`portal_session=${sessions[0][1]}`, secret, env);
        } catch {
          // Malformed encoding is an authentication denial, not an internal leak.
        }
      }
      if (!caregiverId) return json({ ok: false, error: 'unauthorized' }, 401);
      if (env.ENVIRONMENT === 'preview' && !await hasNonarchivedCaregiver(env.LEGACY_DB, caregiverId, env)) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      return await handlePortalSupport(request, env.LEGACY_DB, caregiverId);
    }

    if (action === 'verify') {
      const token = await confirmationToken(request, secret, env);
      if (!token) return json({ ok: false, error: 'forbidden' }, 403);
      return await redeemToken(token, env, secret);
    }

    if (action === 'login') {
      const limited = await checkIpRequestLimit(env.LEGACY_DB, request, IP_LIMITS.portalLogin);
      if (!limited.ok) {
        return json({ ok: false, error: limited.error }, limited.status);
      }

      const body = await request.json().catch(() => ({}));
      const email = body.email;
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return json({ ok: false, error: 'invalid_email' }, 400);
      }

      const qa = previewQACaregiver(env);
      const emailEnabled = qa
        ? canSendEmail(env, { purpose: 'portal-signin', recipient: qa.email, caregiverId: qa.id })
        : canSendEmail(env);
      // Deployment-wide readiness is checked before membership lookup, so the
      // unavailable response cannot reveal whether this address is registered.
      if (!emailEnabled) {
        const reason = 'email_not_configured';
        try {
          await env.LEGACY_DB.prepare(`
            INSERT INTO audit_log (actor, action, entity, entity_id, after_json)
            VALUES ('system', 'portal.login_unavailable', 'portal_token', 'configuration', ?)
          `).bind(JSON.stringify({ reason, provider_status: 0 })).run();
        } catch (error) {
          console.error('portal configuration audit unavailable:', error instanceof Error ? error.name : typeof error);
        }
        return json({ ok: false, error: 'signin_unavailable' }, 503);
      }

      const normalizedEmail = email.toLowerCase().trim();
      if (qa && normalizedEmail !== qa.email) return json({ ok: true });
      const emailHash = await sha256(normalizedEmail);

      // Basic rate limiting via audit_log
      const rateLimitRow = await env.LEGACY_DB
        .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'portal.login_requested' AND actor = ? AND at > datetime('now', '-5 minutes')`)
        .bind(emailHash)
        .first();

      if (rateLimitRow && rateLimitRow.n >= 5) {
        return json({ ok: false, error: 'rate_limited' }, 429);
      }

      // Check if a non-archived caregiver has that email
      const caregiver = await env.LEGACY_DB
        .prepare(qa
          ? `SELECT id, email FROM caregiver WHERE id = ? AND LOWER(TRIM(email)) = ? AND status != 'archived'`
          : `SELECT id, email FROM caregiver WHERE LOWER(TRIM(email)) = ? AND status != 'archived'`)
        .bind(...(qa ? [qa.id, normalizedEmail] : [normalizedEmail]))
        .first();
      if (qa && !matchesPreviewQACaregiver(env, caregiver?.id, caregiver?.email)) return json({ ok: true });

      // Log audit trail login request
      await env.LEGACY_DB
        .prepare(`INSERT INTO audit_log (actor, action, entity, entity_id) VALUES (?, 'portal.login_requested', 'portal_token', ?)`)
        .bind(emailHash, caregiver ? caregiver.id : 'anonymous')
        .run();

      const responseObj = { ok: true };

      if (caregiver) {
        // Mint a single-use, short-TTL (~15 min) opaque token
        const expiresAt = Date.now() + 15 * 60 * 1000;
        const tokenValue = randomToken();

        const tokenHash = await portalTokenHash(tokenValue, env);
        const expiresAtIso = new Date(expiresAt).toISOString().replace('T', ' ').slice(0, 19);

        // Store hash in portal_token table
        await env.LEGACY_DB
          .prepare(`INSERT INTO portal_token (token_hash, caregiver_id, expires_at, used) VALUES (?, ?, ?, 0)`)
          .bind(tokenHash, caregiver.id, expiresAtIso)
          .run();

        // Production: email the link. The response stays the same generic { ok: true } whether or
        // not the email went, so the page never reveals who is a Legacy client.
        if (emailEnabled) {
          const origin = new URL(request.url).origin;
          const link = `${origin}/api/portal/verify?token=${encodeURIComponent(tokenValue)}`;
          const sent = await sendEmail(env, { to: caregiver.email, ...signInEmail(link),
            ...(qa ? { purpose: 'portal-signin', caregiverId: qa.id } : {}) });
          const providerStatus = Number.isInteger(sent.status) ? sent.status : -1;
          const reason = sent.ok ? 'provider_accepted' : providerStatus === -1 ? 'network_error'
            : providerStatus === 0 ? 'email_not_configured' : 'provider_rejected';
          try {
            await env.LEGACY_DB
              .prepare(`INSERT INTO audit_log (actor, action, entity, entity_id, after_json) VALUES ('system', ?, 'caregiver', ?, ?)`)
              .bind(sent.ok ? 'portal.link_emailed' : 'portal.link_email_failed', caregiver.id,
                JSON.stringify({ provider_status: providerStatus, reason }))
              .run();
          } catch (error) {
            // Sending is an external side effect, not a rollbackable DB operation.
            // Audit unavailability must not reveal membership through a different response.
            console.error('portal delivery audit unavailable:', error instanceof Error ? error.name : typeof error, providerStatus);
          }
        }
      }

      return json(responseObj);
    }

    if (action === 'wellness') {
      // POST /api/portal/wellness -- record a check-in for the signed-in caregiver (one a day at most).
      const caregiverId = await parseSessionCookie(request.headers.get('Cookie'), secret, env);
      if (!caregiverId) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      if (!await hasNonarchivedCaregiver(env.LEGACY_DB, caregiverId, env)) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ ok: false, error: 'invalid_body' }, 400);
      }
      const checked = validateCheckin(body);
      if (!checked.ok) {
        return json({ ok: false, error: checked.error }, 400);
      }
      const recent = await env.LEGACY_DB
        .prepare(`SELECT COUNT(*) AS n FROM wellness_checkin WHERE caregiver_id = ? AND created_at > datetime('now', '-1 day')`)
        .bind(caregiverId)
        .first();
      if (recent && Number(recent.n) > 0) {
        return json({ ok: false, error: 'You already checked in today. Thank you!' }, 429);
      }
      const score = await recordCheckin(env.LEGACY_DB, caregiverId, checked.answers, checked.note);
      return json({ ok: true, score });
    }

    if (action === 'logout') {
      const caregiverId = await parseSessionCookie(request.headers.get('Cookie'), secret, env);
      
      // Audit log portal.logout
      if (caregiverId) {
        await env.LEGACY_DB
          .prepare(`INSERT INTO audit_log (actor, action, entity, entity_id) VALUES (?, 'portal.logout', 'caregiver', ?)`)
          .bind(caregiverId, caregiverId)
          .run();
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'content-type': 'application/json',
          'Set-Cookie': CLEARED_SESSION_COOKIE
        }
      });
    }

    return json({ ok: false, error: 'not_found' }, 404);
  } catch (e) {
    console.error('portal handler error:', e instanceof Error ? e.name : typeof e);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
}
