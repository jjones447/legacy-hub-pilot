// GET/POST /api/portal/[[path]] — Magic-link authentication and gated caregiver portal API endpoints (slice 09).
import { checkIpRequestLimit, IP_LIMITS } from '../_shared.mjs';
import { canSendEmail, sendEmail, signInEmail } from '../../_lib/email.js';
import { QUESTIONS, validateCheckin, recordCheckin, caregiverHistory, isCheckinDue, CHECKIN_EVERY_DAYS } from '../../_lib/wellness.js';

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
    headers: { 'content-type': 'application/json' },
  });
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
    headers: { 'content-type': 'text/html; charset=utf-8' },
    status: 400
  });
}

async function parseSessionCookie(cookieHeader, secret) {
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
  const computedSig = await getHmacSha256(`session:${caregiverId}:${exp}`, secret);
  if (!constantTimeEqual(computedSig, signature)) return null;
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || Date.now() > expMs) return null;
  return caregiverId;
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const action = pathSegments[pathSegments.length - 1];

    const secret = env.PORTAL_TOKEN_SECRET;
    if (!secret) {
      return json({ ok: false, error: 'auth_not_configured' }, 503);
    }

    if (action === 'verify') {
      const token = url.searchParams.get('token');
      if (!token) {
        return htmlErrorPage('Missing verification token.');
      }

      // The link carries an opaque random token — no caregiver id, expiry or
      // signature in the URL. Resolve it by its stored hash.
      const tokenHash = await sha256(token);
      const tokenRow = await env.LEGACY_DB
        .prepare(`SELECT caregiver_id, used, expires_at FROM portal_token WHERE token_hash = ?`)
        .bind(tokenHash)
        .first();

      if (!tokenRow) {
        return htmlErrorPage('This access link is unrecognized or has been revoked.');
      }

      if (tokenRow.used === 1) {
        return htmlErrorPage('This access link has already been used.');
      }

      const expiresAtMs = Date.parse(tokenRow.expires_at.replace(' ', 'T') + 'Z');
      if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
        return htmlErrorPage('This access link has expired (15-minute limit).');
      }

      const caregiverId = tokenRow.caregiver_id;

      // Claim the token atomically: only one request can flip used 0 -> 1, so two simultaneous
      // clicks on the same link cannot both sign in.
      const claim = await env.LEGACY_DB
        .prepare(`UPDATE portal_token SET used = 1 WHERE token_hash = ? AND used = 0`)
        .bind(tokenHash)
        .run();
      if (!claim || !claim.meta || claim.meta.changes !== 1) {
        return htmlErrorPage('This access link has already been used.');
      }

      // Audit log portal.login_success
      await env.LEGACY_DB
        .prepare(`INSERT INTO audit_log (actor, action, entity, entity_id) VALUES (?, 'portal.login_success', 'caregiver', ?)`)
        .bind(caregiverId, caregiverId)
        .run();

      // Set signed session cookie
      const sessionExp = Date.now() + 2 * 60 * 60 * 1000; // 2 hours
      const sessionPayload = `${caregiverId}:${sessionExp}`;
      const sessionSig = await getHmacSha256(`session:${sessionPayload}`, secret);
      const cookieValue = encodeURIComponent(`${sessionPayload}:${sessionSig}`);
      const cookieHeader = `portal_session=${cookieValue}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7200`;

      return new Response(null, {
        status: 302,
        headers: {
          'Location': '/portal.html',
          'Set-Cookie': cookieHeader
        }
      });
    }

    if (action === 'me') {
      const caregiverId = await parseSessionCookie(request.headers.get('Cookie'), secret);
      if (!caregiverId) {
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
                  WHERE ga.caregiver_id = ?`)
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
      const caregiverId = await parseSessionCookie(request.headers.get('Cookie'), secret);
      if (!caregiverId) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      const history = await caregiverHistory(env.LEGACY_DB, caregiverId);
      const latest = history.length ? history[history.length - 1].created_at : null;
      return json({ ok: true, history, due: isCheckinDue(latest), every_days: CHECKIN_EVERY_DAYS, questions: QUESTIONS });
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

    const secret = env.PORTAL_TOKEN_SECRET;
    if (!secret) {
      return json({ ok: false, error: 'auth_not_configured' }, 503);
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

      const normalizedEmail = email.toLowerCase().trim();
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
        .prepare(`SELECT id, email FROM caregiver WHERE LOWER(TRIM(email)) = ? AND status != 'archived'`)
        .bind(normalizedEmail)
        .first();

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

        const tokenHash = await sha256(tokenValue);
        const expiresAtIso = new Date(expiresAt).toISOString().replace('T', ' ').slice(0, 19);

        // Store hash in portal_token table
        await env.LEGACY_DB
          .prepare(`INSERT INTO portal_token (token_hash, caregiver_id, expires_at, used) VALUES (?, ?, ?, 0)`)
          .bind(tokenHash, caregiver.id, expiresAtIso)
          .run();

        // If dev return link mode is enabled, provide the link in response
        // SEC-4: dev-return-link only in an explicitly non-prod environment (positive
        // allowlist — never leaks when ENVIRONMENT is unset, i.e. production default).
        if ((env.PORTAL_DEV_RETURN_LINK === '1' || env.PORTAL_DEV_RETURN_LINK === 1)
            && (env.ENVIRONMENT === 'preview' || env.ENVIRONMENT === 'development')) {
          responseObj.dev_link = `/api/portal/verify?token=${encodeURIComponent(tokenValue)}`;
        }

        // Production: email the link. The response stays the same generic { ok: true } whether or
        // not the email went, so the page never reveals who is a Legacy client.
        if (canSendEmail(env)) {
          const origin = new URL(request.url).origin;
          const link = `${origin}/api/portal/verify?token=${encodeURIComponent(tokenValue)}`;
          const sent = await sendEmail(env, { to: caregiver.email, ...signInEmail(link) });
          await env.LEGACY_DB
            .prepare(`INSERT INTO audit_log (actor, action, entity, entity_id) VALUES ('system', ?, 'caregiver', ?)`)
            .bind(sent.ok ? 'portal.link_emailed' : 'portal.link_email_failed', caregiver.id)
            .run();
        }
      }

      return json(responseObj);
    }

    if (action === 'wellness') {
      // POST /api/portal/wellness -- record a check-in for the signed-in caregiver (one a day at most).
      const caregiverId = await parseSessionCookie(request.headers.get('Cookie'), secret);
      if (!caregiverId) {
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
      const caregiverId = await parseSessionCookie(request.headers.get('Cookie'), secret);
      
      // Audit log portal.logout
      if (caregiverId) {
        await env.LEGACY_DB
          .prepare(`INSERT INTO audit_log (actor, action, entity, entity_id) VALUES (?, 'portal.logout', 'caregiver', ?)`)
          .bind(caregiverId, caregiverId)
          .run();
      }

      const cookieHeader = 'portal_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'Set-Cookie': cookieHeader
        }
      });
    }

    return json({ ok: false, error: 'not_found' }, 404);
  } catch (e) {
    console.error('portal handler error:', e instanceof Error ? e.name : typeof e);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
}
