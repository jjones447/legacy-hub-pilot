// POST /api/webhooks/square -- Square payments webhook ingestion (D3).

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

    const externalRef = body.event_id || body.id;
    if (!externalRef) {
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

    // Idempotency: same (source='square', external_ref) -> no-op, return 200
    const dupReg = await env.LEGACY_DB
      .prepare('SELECT id FROM registration WHERE source = \'square\' AND external_ref = ?')
      .bind(externalRef)
      .first();
    const dupFollow = await env.LEGACY_DB
      .prepare('SELECT id FROM followup WHERE source = \'square\' AND external_ref = ?')
      .bind(externalRef)
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
      const paymentId = payment.id || body.data?.id || 'unknown';
      let detail = `Square unmatched payment: payment_id=${paymentId}, event_id=${externalRef}`;
      if (payment.amount_money?.amount != null) {
        const amt = (payment.amount_money.amount / 100).toFixed(2);
        detail += `, amount=$${amt}`;
      }

      const caregiverId = 'cg_unmatched';
      await env.LEGACY_DB
        .prepare(`
          INSERT INTO followup (caregiver_id, kind, detail, source, external_ref)
          VALUES (?, 'payment_unmatched', ?, 'square', ?)
        `)
        .bind(caregiverId, detail, externalRef)
        .run();

      const row = await env.LEGACY_DB.prepare('SELECT last_insert_rowid() AS id').first();
      const entityId = row ? row.id : externalRef;

      await env.LEGACY_DB
        .prepare(`
          INSERT INTO audit_log (actor, action, entity, entity_id, after_json)
          VALUES ('square_webhook', ?, 'followup', ?, ?)
        `)
        .bind(
          `webhook.${eventType}`,
          entityId.toString(),
          JSON.stringify({ kind: 'payment_unmatched', external_ref: externalRef, detail })
        )
        .run();

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
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    if (caregiver) {
      caregiverId = caregiver.id;
      await env.LEGACY_DB
        .prepare('UPDATE caregiver SET updated_at = ? WHERE id = ?')
        .bind(now, caregiverId)
        .run();
    } else {
      caregiverId = 'cg_' + crypto.randomUUID();
      await env.LEGACY_DB
        .prepare(`
          INSERT INTO caregiver (id, first_name, last_name, email, phone, source, donor)
          VALUES (?, ?, ?, ?, ?, 'square', 1)
        `)
        .bind(caregiverId, firstName, lastName, email, phone)
        .run();
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
    let entityId;

    if (matchedEventId) {
      entity = 'registration';
      await env.LEGACY_DB
        .prepare(`
          INSERT INTO registration (caregiver_id, event_id, source, external_ref)
          VALUES (?, ?, 'square', ?)
        `)
        .bind(caregiverId, matchedEventId, externalRef)
        .run();
      const row = await env.LEGACY_DB.prepare('SELECT last_insert_rowid() AS id').first();
      entityId = row ? row.id : externalRef;
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

      await env.LEGACY_DB
        .prepare(`
          INSERT INTO followup (caregiver_id, kind, detail, source, external_ref)
          VALUES (?, 'donation_received', ?, 'square', ?)
        `)
        .bind(caregiverId, detail, externalRef)
        .run();
      const row = await env.LEGACY_DB.prepare('SELECT last_insert_rowid() AS id').first();
      entityId = row ? row.id : externalRef;
    }

    // Write audit log
    await env.LEGACY_DB
      .prepare(`
        INSERT INTO audit_log (actor, action, entity, entity_id, after_json)
        VALUES ('square_webhook', ?, ?, ?, ?)
      `)
      .bind(
        `webhook.${eventType}`,
        entity,
        entityId.toString(),
        JSON.stringify({ caregiver_id: caregiverId, external_ref: externalRef })
      )
      .run();

    return json({ ok: true, caregiver_id: caregiverId, entity, entity_id: entityId });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
