// POST /api/webhooks/square -- Square payments webhook ingestion (D3).
import { internalError } from '../../_lib/errors.js';

async function getHmacSha256Base64(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(message)
  );
  const bytes = new Uint8Array(signatureBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
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
    const signatureKey = env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    const notificationUrl = env.SQUARE_WEBHOOK_URL;
    if (!signatureKey || !notificationUrl) {
      return json({ ok: false, error: 'webhook_not_configured' }, 503);
    }

    const signatureHeader = request.headers.get('x-square-hmacsha256-signature');
    if (!signatureHeader) {
      return json({ ok: false, error: 'missing signature header' }, 401);
    }

    const rawBody = await request.text();
    const messageToSign = notificationUrl + rawBody;
    const computedSignature = await getHmacSha256Base64(messageToSign, signatureKey);
    if (!constantTimeEqual(computedSignature, signatureHeader)) {
      return json({ ok: false, error: 'invalid signature' }, 401);
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json({ ok: false, error: 'invalid JSON body' }, 400);
    }

    const eventId = body.event_id || body.id;
    if (typeof eventId !== 'string' || !eventId.trim()) {
      return json({ ok: false, error: 'missing event id' }, 400);
    }

    const eventType = body.type || body.event_type || body.event || '';
    const payment = body.data?.object?.payment || body.data?.object || {};

    if (eventType === 'payment.completed') {
      // Process payment.completed
    } else if (eventType === 'payment.updated') {
      const status = payment.status || body.data?.object?.status;
      if (status !== 'COMPLETED') {
        return json({ ok: true, ignored: true });
      }
    } else {
      return json({ ok: true, ignored: true });
    }

    const paymentId = payment.id;
    if (typeof paymentId !== 'string' || !paymentId.trim()) {
      return json({ ok: false, error: 'missing payment id' }, 400);
    }
    // A completed payment can emit multiple payment.updated events (e.g. fees).
    // New records deduplicate the payment, not each delivery event. Preserve the
    // old event-key lookup for same-event retries without rewriting old rows.
    const externalRef = `payment:${paymentId}`;
    const dupReg = await env.LEGACY_DB
      .prepare('SELECT id FROM registration WHERE source = \'square\' AND external_ref IN (?, ?)')
      .bind(externalRef, eventId)
      .first();
    const dupFollow = await env.LEGACY_DB
      .prepare('SELECT id FROM followup WHERE source = \'square\' AND external_ref IN (?, ?)')
      .bind(externalRef, eventId)
      .first();

    if (dupReg || dupFollow) {
      return json({ ok: true, duplicate: true });
    }

    const order = payment.order || body.data?.object?.order || body.data?.order || {};

    const rawEmail = (
      payment.buyer_email_address ||
      payment.email ||
      order.customer?.email_address ||
      order.customer?.email ||
      body.data?.customer?.email ||
      null
    );
    const email = rawEmail ? rawEmail.trim() : null;

    const rawPhone = (
      payment.buyer_phone_number ||
      payment.phone ||
      order.customer?.phone_number ||
      order.customer?.phone ||
      null
    );
    const phone = rawPhone ? rawPhone.trim() : null;

    // Contact extraction & unmatched handling
    if (!email && !phone) {
      let detail = `Square unmatched payment: payment_id=${paymentId}, event_id=${eventId}`;
      if (payment.amount_money?.amount != null) {
        const amt = (payment.amount_money.amount / 100).toFixed(2);
        detail += `, amount=$${amt}`;
      }

      const caregiverId = 'cg_unmatched_square';
      const results = await env.LEGACY_DB.batch([
        env.LEGACY_DB.prepare(`
          INSERT OR IGNORE INTO caregiver (id, first_name, last_name, source, status)
          VALUES ('cg_unmatched_square', 'Unmatched', 'Square payment', 'square', 'inactive')
        `),
        env.LEGACY_DB.prepare(`
          INSERT INTO followup (caregiver_id, kind, detail, source, external_ref)
          VALUES (?, 'payment_unmatched', ?, 'square', ?)
        `)
        .bind(caregiverId, detail, externalRef),
        env.LEGACY_DB.prepare(`
          INSERT INTO audit_log (actor, action, entity, entity_id, after_json)
          SELECT 'square_webhook', ?, 'followup', CAST(id AS TEXT), ? FROM followup
          WHERE source = 'square' AND external_ref = ? AND caregiver_id = ?
        `)
        .bind(
          `webhook.${eventType}`,
          JSON.stringify({ kind: 'payment_unmatched', external_ref: externalRef, payment_id: paymentId, event_id: eventId, detail }),
          externalRef, caregiverId
        ),
        env.LEGACY_DB.prepare(`SELECT id FROM followup
          WHERE source = 'square' AND external_ref = ? AND caregiver_id = ?`)
          .bind(externalRef, caregiverId),
      ]);
      const entityId = batchEntityId(results);

      return json({ ok: true, unmatched: true, entity: 'followup', entity_id: entityId });
    }

    // Name extraction for caregiver record
    let firstName = 'Square';
    let lastName = 'Donor';
    if (order.customer?.given_name || order.customer?.family_name) {
      firstName = order.customer.given_name || 'Square';
      lastName = order.customer.family_name || 'Donor';
    } else if (order.customer?.first_name || order.customer?.last_name) {
      firstName = order.customer.first_name || 'Square';
      lastName = order.customer.last_name || 'Donor';
    } else if (payment.buyer_name) {
      const parts = payment.buyer_name.trim().split(/\s+/);
      firstName = parts[0] || 'Square';
      lastName = parts.slice(1).join(' ') || 'Donor';
    }

    // Upsert caregiver by email (fallback phone)
    const matchField = email ? 'email' : 'phone';
    const matchValue = email ? email.toLowerCase() : phone;
    const caregiver = await env.LEGACY_DB
      .prepare(`SELECT id FROM caregiver WHERE LOWER(${matchField}) = LOWER(?) AND status != 'archived'`)
      .bind(matchValue)
      .first();

    let caregiverId;
    let caregiverWrite;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    if (caregiver) {
      caregiverId = caregiver.id;
      caregiverWrite = env.LEGACY_DB
        .prepare('UPDATE caregiver SET updated_at = ? WHERE id = ?')
        .bind(now, caregiverId);
    } else {
      caregiverId = 'cg_' + crypto.randomUUID();
      caregiverWrite = env.LEGACY_DB
        .prepare(`
          INSERT INTO caregiver (id, first_name, last_name, email, phone, source, donor)
          VALUES (?, ?, ?, ?, ?, 'square', 1)
        `)
        .bind(caregiverId, firstName, lastName, email, phone);
    }

    // Check if an order line item note or catalog_object_id maps to a published event
    const lineItems = order.line_items || payment.line_items || body.data?.line_items || [];
    let matchedEventId = null;

    for (const item of lineItems) {
      const candidates = [item.note, item.catalog_object_id, item.item_variation_id].filter(Boolean);
      for (const candidate of candidates) {
        const ev = await env.LEGACY_DB
          .prepare('SELECT id FROM event WHERE id = ? AND publish_state = \'published\'')
          .bind(candidate)
          .first();
        if (ev) {
          matchedEventId = ev.id;
          break;
        }
      }
      if (matchedEventId) break;
    }

    if (!matchedEventId) {
      const noteCandidate = payment.note || order.note;
      if (noteCandidate) {
        const ev = await env.LEGACY_DB
          .prepare('SELECT id FROM event WHERE id = ? AND publish_state = \'published\'')
          .bind(noteCandidate)
          .first();
        if (ev) {
          matchedEventId = ev.id;
        }
      }
    }

    let entity;
    let resultWrite;

    if (matchedEventId) {
      entity = 'registration';
      resultWrite = env.LEGACY_DB
        .prepare(`
          INSERT INTO registration (caregiver_id, event_id, source, external_ref)
          VALUES (?, ?, 'square', ?)
        `)
        .bind(caregiverId, matchedEventId, externalRef);
    } else {
      entity = 'followup';
      let amountStr = '';
      if (payment.amount_money?.amount != null) {
        amountStr = `$${(payment.amount_money.amount / 100).toFixed(2)}`;
      } else if (payment.total_money?.amount != null) {
        amountStr = `$${(payment.total_money.amount / 100).toFixed(2)}`;
      } else if (payment.amount != null) {
        amountStr = String(payment.amount);
      }
      const detail = amountStr ? `Square donation received: ${amountStr}` : 'Square donation received';

      resultWrite = env.LEGACY_DB
        .prepare(`
          INSERT INTO followup (caregiver_id, kind, detail, source, external_ref)
          VALUES (?, 'donation_received', ?, 'square', ?)
        `)
        .bind(caregiverId, detail, externalRef);
    }

    // Caregiver, result and original audit commit together; no cross-call row ID.
    // entity is selected only from the two fixed branches above, never input SQL.
    const results = await env.LEGACY_DB.batch([
      caregiverWrite,
      resultWrite,
      env.LEGACY_DB.prepare(`
        INSERT INTO audit_log (actor, action, entity, entity_id, after_json)
        SELECT 'square_webhook', ?, ?, CAST(id AS TEXT), ? FROM ${entity}
        WHERE source = 'square' AND external_ref = ? AND caregiver_id = ?
      `)
      .bind(
        `webhook.${eventType}`,
        entity,
        JSON.stringify({ caregiver_id: caregiverId, external_ref: externalRef, payment_id: paymentId, event_id: eventId }),
        externalRef, caregiverId
      ),
      env.LEGACY_DB.prepare(`SELECT id FROM ${entity}
        WHERE source = 'square' AND external_ref = ? AND caregiver_id = ?`)
        .bind(externalRef, caregiverId),
    ]);
    const entityId = batchEntityId(results);

    return json({ ok: true, caregiver_id: caregiverId, entity, entity_id: entityId });
  } catch (e) {
    return internalError('/api/webhooks/square', e);
  }
}
