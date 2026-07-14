// GET/POST /api/portal/[[path]] — Magic-link authentication and gated caregiver portal API endpoints (slice 09).

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
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f9fafb; color: #111827; }
    .card { padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 100%; border: 1px solid #e5e7eb; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; color: #dc2626; }
    p { color: #4b5563; line-height: 1.5; margin-bottom: 1.5rem; }
    a { display: inline-block; padding: 0.5rem 1rem; background: #2563eb; color: white; text-decoration: none; border-radius: 4px; font-weight: 500; }
    a:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Access Link Error</h1>
    <p>${message}</p>
    <a href="/portal.html">Go to Login Page</a>
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
  const computedSig = await getHmacSha256(`${caregiverId}:${exp}`, secret);
  if (!constantTimeEqual(computedSig, signature)) return null;
  if (Date.now() > Number(exp)) return null;
  return caregiverId;
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const action = pathSegments[pathSegments.length - 1];

    const secret = env.PORTAL_TOKEN_SECRET || 'dev_secret_only';

    if (action === 'verify') {
      const token = url.searchParams.get('token');
      if (!token) {
        return htmlErrorPage('Missing verification token.');
      }

      const parts = token.split(':');
      if (parts.length !== 3) {
        return htmlErrorPage('The access link is malformed or invalid.');
      }

      const [caregiverId, expiresAtStr, signature] = parts;
      const expiresAt = Number(expiresAtStr);

      // Verify HMAC signature
      const computedSig = await getHmacSha256(`${caregiverId}:${expiresAtStr}`, secret);
      if (!constantTimeEqual(computedSig, signature)) {
        return htmlErrorPage('The access link has an invalid signature.');
      }

      // Check expiry in payload
      if (Date.now() > expiresAt) {
        return htmlErrorPage('This access link has expired (15-minute limit).');
      }

      // Check database to ensure it's not used and not expired there
      const tokenHash = await sha256(token);
      const tokenRow = await env.LEGACY_DB
        .prepare(`SELECT used, expires_at FROM portal_token WHERE token_hash = ?`)
        .bind(tokenHash)
        .first();

      if (!tokenRow) {
        return htmlErrorPage('This access link is unrecognized or has been revoked.');
      }

      if (tokenRow.used === 1) {
        return htmlErrorPage('This access link has already been used.');
      }

      // Mark token as used
      await env.LEGACY_DB
        .prepare(`UPDATE portal_token SET used = 1 WHERE token_hash = ?`)
        .bind(tokenHash)
        .run();

      // Audit log portal.login_success
      await env.LEGACY_DB
        .prepare(`INSERT INTO audit_log (actor, action, entity, entity_id) VALUES (?, 'portal.login_success', 'caregiver', ?)`)
        .bind(caregiverId, caregiverId)
        .run();

      // Set signed session cookie
      const sessionExp = Date.now() + 2 * 60 * 60 * 1000; // 2 hours
      const sessionPayload = `${caregiverId}:${sessionExp}`;
      const sessionSig = await getHmacSha256(sessionPayload, secret);
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

    return json({ ok: false, error: 'not_found' }, 404);
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const action = pathSegments[pathSegments.length - 1];

    const secret = env.PORTAL_TOKEN_SECRET || 'dev_secret_only';

    if (action === 'login') {
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
        .prepare(`SELECT id FROM caregiver WHERE LOWER(TRIM(email)) = ? AND status != 'archived'`)
        .bind(normalizedEmail)
        .first();

      // Log audit trail login request
      await env.LEGACY_DB
        .prepare(`INSERT INTO audit_log (actor, action, entity, entity_id) VALUES (?, 'portal.login_requested', 'portal_token', ?)`)
        .bind(emailHash, caregiver ? caregiver.id : 'anonymous')
        .run();

      const responseObj = { ok: true };

      if (caregiver) {
        // Mint a single-use, short-TTL (~15 min), HMAC-signed token
        const expiresAt = Date.now() + 15 * 60 * 1000;
        const expiresAtStr = String(expiresAt);
        const payload = `${caregiver.id}:${expiresAtStr}`;
        const signature = await getHmacSha256(payload, secret);
        const tokenValue = `${payload}:${signature}`;

        const tokenHash = await sha256(tokenValue);
        const expiresAtIso = new Date(expiresAt).toISOString().replace('T', ' ').slice(0, 19);

        // Store hash in portal_token table
        await env.LEGACY_DB
          .prepare(`INSERT INTO portal_token (token_hash, caregiver_id, expires_at, used) VALUES (?, ?, ?, 0)`)
          .bind(tokenHash, caregiver.id, expiresAtIso)
          .run();

        // If dev return link mode is enabled, provide the link in response
        if (env.PORTAL_DEV_RETURN_LINK === '1' || env.PORTAL_DEV_RETURN_LINK === 1) {
          responseObj.dev_link = `/api/portal/verify?token=${encodeURIComponent(tokenValue)}`;
        }
      }

      return json(responseObj);
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
    return json({ ok: false, error: e.message }, 500);
  }
}
