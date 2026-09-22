// POST /webhooks/givebutter — GiveButter donations/registrations webhook ingestion.

async function computeHmacSha256Hex(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
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
    // 1. Verify signature before trusting anything.
    // Read secret from env.GIVEBUTTER_WEBHOOK_SECRET and reject with 401 when absent, malformed or does not match.
    const secret = env?.GIVEBUTTER_WEBHOOK_SECRET;
    if (!secret || typeof secret !== 'string' || secret.trim() === '') {
      return json({ ok: false, error: 'webhook signature verification failed' }, 401);
    }

    const signatureHeader = request.headers.get('Signature') || request.headers.get('signature');
    if (!signatureHeader || typeof signatureHeader !== 'string' || signatureHeader.trim() === '') {
      return json({ ok: false, error: 'missing signature header' }, 401);
    }

    const rawBody = await request.text();
    const expectedSig = await computeHmacSha256Hex(rawBody, secret);

    let providedSig = signatureHeader.trim();
    if (providedSig.toLowerCase().startsWith('sha256=')) {
      providedSig = providedSig.slice(7).trim();
    }

    if (!constantTimeEqual(expectedSig.toLowerCase(), providedSig.toLowerCase())) {
      return json({ ok: false, error: 'invalid signature' }, 401);
    }

    // 2. Parse JSON body fast, never echo payload back on error
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json({ ok: false, error: 'invalid JSON body' }, 400);
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ ok: false, error: 'invalid JSON body' }, 400);
    }

    // 3. Idempotent deduplication on event id / external_ref
    const externalRef = body.id || body.data?.id;
    if (!externalRef || typeof externalRef !== 'string') {
      return json({ ok: false, error: 'missing event id' }, 400);
    }

    const dupReg = await env.LEGACY_DB
      .prepare("SELECT id FROM registration WHERE source = 'givebutter' AND external_ref = ?")
      .bind(externalRef)
      .first();
    const dupFollow = await env.LEGACY_DB
      .prepare("SELECT id FROM followup WHERE source = 'givebutter' AND external_ref = ?")
      .bind(externalRef)
      .first();

    if (dupReg || dupFollow) {
      return json({ ok: true, duplicate: true }, 200);
    }

    // 4. Match donor to existing caregiver record by email, case-insensitively and trimmed.
    // On no match, create a contact-only record rather than dropping the donation; never merge two records on a partial match.
    const rawEmail = body.data?.contact?.email || body.data?.email || null;
    const email = typeof rawEmail === 'string' && rawEmail.trim() ? rawEmail.trim().toLowerCase() : null;

    const rawPhone = body.data?.contact?.phone || body.data?.phone || null;
    const phone = typeof rawPhone === 'string' && rawPhone.trim() ? rawPhone.trim() : null;
    const firstName = body.data?.contact?.first_name || body.data?.first_name || 'Givebutter';
    const lastName = body.data?.contact?.last_name || body.data?.last_name || 'Donor';

    let caregiver = null;
    if (email) {
      caregiver = await env.LEGACY_DB
        .prepare("SELECT id FROM caregiver WHERE LOWER(TRIM(email)) = ? AND status != 'archived'")
        .bind(email)
        .first();
    }

    let caregiverId;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    if (caregiver) {
      caregiverId = caregiver.id;
      await env.LEGACY_DB
        .prepare("UPDATE caregiver SET updated_at = ?, donor = 1 WHERE id = ?")
        .bind(now, caregiverId)
        .run();
    } else {
      caregiverId = 'cg_' + crypto.randomUUID();
      await env.LEGACY_DB
        .prepare(`
          INSERT INTO caregiver (id, first_name, last_name, email, phone, source, donor)
          VALUES (?, ?, ?, ?, ?, 'givebutter', 1)
        `)
        .bind(caregiverId, firstName, lastName, email, phone)
        .run();
    }

    // 5. Land the donation or event registration
    const eventId = body.data?.event_id || body.data?.campaign_id || null;
    let eventExists = false;
    if (eventId) {
      const ev = await env.LEGACY_DB
        .prepare("SELECT id FROM event WHERE id = ? AND publish_state = 'published'")
        .bind(eventId)
        .first();
      if (ev) {
        eventExists = true;
      }
    }

    let entity;
    let entityId;

    if (eventExists) {
      entity = 'registration';
      await env.LEGACY_DB
        .prepare("INSERT INTO registration (caregiver_id, event_id, source, external_ref) VALUES (?, ?, 'givebutter', ?)")
        .bind(caregiverId, eventId, externalRef)
        .run();
      const row = await env.LEGACY_DB.prepare("SELECT last_insert_rowid() AS id").first();
      entityId = row ? row.id : externalRef;
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

      await env.LEGACY_DB
        .prepare("INSERT INTO followup (caregiver_id, kind, detail, source, external_ref) VALUES (?, ?, ?, 'givebutter', ?)")
        .bind(caregiverId, kind, detail, externalRef)
        .run();
      const row = await env.LEGACY_DB.prepare("SELECT last_insert_rowid() AS id").first();
      entityId = row ? row.id : externalRef;
    }

    // 6. Write audit row for every accepted event
    await env.LEGACY_DB
      .prepare(`
        INSERT INTO audit_log (actor, action, entity, entity_id, after_json)
        VALUES ('givebutter_webhook', ?, ?, ?, ?)
      `)
      .bind(
        `webhook.${body.event || 'generic'}`,
        entity,
        entityId.toString(),
        JSON.stringify({ caregiver_id: caregiverId, external_ref: externalRef })
      )
      .run();

    return json({ ok: true, caregiver_id: caregiverId, entity, entity_id: entityId }, 200);
  } catch {
    return json({ ok: false, error: 'internal_server_error' }, 500);
  }
}
