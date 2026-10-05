// POST /api/webhooks/givebutter — GiveButter donations/registrations webhook ingestion (slice 08).
import { internalError } from '../../_lib/errors.js';

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

async function secretEqual(a, b) {
  const enc = new TextEncoder();
  const [aHash, bHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  // Workers provides the native timing-safe operation. Node synthetic tests
  // use a fixed-size comparison instead; neither branch compares secret lengths.
  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(aHash, bHash);
  }
  const aBytes = new Uint8Array(aHash);
  const bBytes = new Uint8Array(bHash);
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}

function resourceId(value) {
  if (typeof value === 'string' && value.length > 0 && value.length <= 200) return value;
  if (Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

function externalReference(body) {
  // Preserve explicit delivery IDs used by the legacy adapter. Official
  // transaction/ticket payloads carry only data.id; namespace by event kind.
  if (body.id !== undefined && body.id !== null) return resourceId(body.id);
  if (body.event !== 'transaction.succeeded' && body.event !== 'ticket.created') return null;
  const id = resourceId(body.data?.id);
  return id === null ? null : `${body.event}:${id}`;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function batchEntityId(results) {
  if (!Array.isArray(results) || results.length !== 4 || [0, 1, 2, 3].some(index => results[index]?.success !== true)) {
    throw new Error('invalid payment batch result');
  }
  const rows = results[3].results;
  if (!Array.isArray(rows) || rows.length !== 1 || !Number.isSafeInteger(rows[0]?.id) || rows[0].id <= 0) {
    throw new Error('missing payment result identity');
  }
  return rows[0].id;
}

export async function onRequestPost({ request, env }) {
  try {
    const secret = env.GIVEBUTTER_WEBHOOK_SECRET;
    if (!secret) {
      return json({ ok: false, error: 'webhook_not_configured' }, 503);
    }

    // Givebutter documents a Signature header containing the dashboard secret.
    // Old adapters can explicitly retain raw-body HMAC; never auto-detect modes.
    const mode = env.GIVEBUTTER_WEBHOOK_SIGNATURE_MODE ?? 'secret';
    if (mode !== 'secret' && mode !== 'hmac_sha256') {
      return json({ ok: false, error: 'webhook_not_configured' }, 503);
    }

    const signatureHeader = request.headers.get('Signature');
    if (!signatureHeader) {
      return json({ ok: false, error: 'missing signature header' }, 401);
    }

    const rawBody = await request.text();
    const expectedSignature = mode === 'secret' ? secret : await getHmacSha256(rawBody, secret);
    if (!await secretEqual(expectedSignature, signatureHeader)) {
      return json({ ok: false, error: 'invalid signature' }, 401);
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch (e) {
      return json({ ok: false, error: 'invalid JSON body' }, 400);
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ ok: false, error: 'invalid JSON body' }, 400);
    }
    const externalRef = externalReference(body);
    if (externalRef === null) {
      return json({ ok: false, error: 'missing event id' }, 400);
    }

    // Idempotency: same (source='givebutter', external_ref) -> no-op, return 200
    const dupReg = await env.LEGACY_DB
      .prepare(`SELECT id FROM registration WHERE source = 'givebutter' AND external_ref = ?`)
      .bind(externalRef)
      .first();
    const dupFollow = await env.LEGACY_DB
      .prepare(`SELECT id FROM followup WHERE source = 'givebutter' AND external_ref = ?`)
      .bind(externalRef)
      .first();

    if (dupReg || dupFollow) {
      return json({ ok: true, duplicate: true });
    }

    // Extract contact details
    const email = body.data?.contact?.email || body.data?.email || null;
    const phone = body.data?.contact?.phone || body.data?.phone || null;
    const firstName = body.data?.contact?.first_name || body.data?.first_name || 'Givebutter';
    const lastName = body.data?.contact?.last_name || body.data?.last_name || 'Donor';

    if (!email && !phone) {
      return json({ ok: false, error: 'missing contact email or phone' }, 400);
    }

    // Upsert caregiver by email (fallback phone)
    const matchField = email ? 'email' : 'phone';
    const matchValue = email || phone;
    let caregiver = await env.LEGACY_DB
      .prepare(`SELECT id FROM caregiver WHERE ${matchField} = ? AND status != 'archived'`)
      .bind(matchValue)
      .first();

    let caregiverId;
    let caregiverWrite;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    if (caregiver) {
      caregiverId = caregiver.id;
      caregiverWrite = env.LEGACY_DB
        .prepare(`UPDATE caregiver SET updated_at = ? WHERE id = ?`)
        .bind(now, caregiverId);
    } else {
      caregiverId = 'cg_' + crypto.randomUUID();
      caregiverWrite = env.LEGACY_DB
        .prepare(`
          INSERT INTO caregiver (id, first_name, last_name, email, phone, source)
          VALUES (?, ?, ?, ?, ?, 'givebutter')
        `)
        .bind(caregiverId, firstName, lastName, email, phone);
    }

    // Check if it maps to an event in our event table
    const eventId = body.data?.event_id || body.data?.campaign_id || null;
    let eventExists = false;
    if (eventId) {
      const ev = await env.LEGACY_DB
        .prepare(`SELECT id FROM event WHERE id = ? AND publish_state = 'published'`)
        .bind(eventId)
        .first();
      if (ev) {
        eventExists = true;
      }
    }

    let entity;
    let resultWrite;

    if (eventExists) {
      entity = 'registration';
      resultWrite = env.LEGACY_DB
        .prepare(`INSERT INTO registration (caregiver_id, event_id, source, external_ref) VALUES (?, ?, 'givebutter', ?)`)
        .bind(caregiverId, eventId, externalRef);
    } else {
      entity = 'followup';
      const eventType = body.event || '';
      const isTransaction = eventType.startsWith('transaction') || body.data?.amount !== undefined;
      const kind = isTransaction ? 'donation' : 'gb_registration';

      let detail = `Givebutter event: ${eventType}`;
      if (isTransaction && body.data?.amount) {
        detail = `Givebutter donation: ${body.data.amount}`;
      } else if (body.data?.campaign_name) {
        detail = `Givebutter registration: ${body.data.campaign_name}`;
      }

      resultWrite = env.LEGACY_DB
        .prepare(`INSERT INTO followup (caregiver_id, kind, detail, source, external_ref) VALUES (?, ?, ?, 'givebutter', ?)`)
        .bind(caregiverId, kind, detail, externalRef);
    }

    // All three mutations share one transaction. entity is a fixed branch value.
    const results = await env.LEGACY_DB.batch([
      caregiverWrite,
      resultWrite,
      env.LEGACY_DB.prepare(`
        INSERT INTO audit_log (actor, action, entity, entity_id, after_json)
        SELECT 'givebutter_webhook', ?, ?, CAST(id AS TEXT), ? FROM ${entity}
        WHERE source = 'givebutter' AND external_ref = ? AND caregiver_id = ?
      `)
      .bind(
        `webhook.${body.event || 'generic'}`,
        entity,
        JSON.stringify({ caregiver_id: caregiverId, external_ref: externalRef }),
        externalRef, caregiverId
      ),
      env.LEGACY_DB.prepare(`SELECT id FROM ${entity}
        WHERE source = 'givebutter' AND external_ref = ? AND caregiver_id = ?`)
        .bind(externalRef, caregiverId),
    ]);
    const entityId = batchEntityId(results);

    return json({ ok: true, caregiver_id: caregiverId, entity, entity_id: entityId });
  } catch (e) {
    return internalError('/api/webhooks/givebutter', e);
  }
}
