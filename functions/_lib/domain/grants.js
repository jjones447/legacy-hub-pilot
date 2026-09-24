// Domain module for grant workflow transitions (slice D7-S1).
// Exports validate and apply functions used by both REST handlers and the agent.

export async function validate(db, { id, operation, payload = {} }) {
  const grantId = parseInt(id, 10);
  if (isNaN(grantId)) {
    return { ok: false, status: 400, error: 'invalid grant application id' };
  }

  const normalizedOp = operation === 'course-complete' ? 'course_complete' : operation;
  if (!['review', 'decision', 'course_complete', 'close'].includes(normalizedOp)) {
    return { ok: false, status: 400, error: 'unsupported action' };
  }

  const app = await db
    .prepare('SELECT id, caregiver_id, requested_for, status, review_notes FROM grant_application WHERE id = ?')
    .bind(grantId)
    .first();

  if (!app) {
    return { ok: false, status: 404, error: 'grant application not found' };
  }

  if (normalizedOp === 'review') {
    if (app.status !== 'submitted' && app.status !== 'in_review') {
      return { ok: false, status: 409, error: `cannot review from status ${app.status}` };
    }
    const review_notes = payload.review_notes || app.review_notes || null;
    const beforeState = { status: app.status, review_notes: app.review_notes };
    const afterState = { status: 'in_review', review_notes };
    return {
      ok: true,
      current: app,
      projected: { ...app, status: 'in_review', review_notes },
      before: beforeState,
      after: afterState,
      operation: 'review',
      payload: { review_notes }
    };
  }

  if (normalizedOp === 'decision') {
    if (app.status !== 'in_review') {
      return { ok: false, status: 409, error: `cannot make decision from status ${app.status}` };
    }
    if (!['awarded', 'declined'].includes(payload.decision)) {
      return { ok: false, status: 400, error: "decision must be 'awarded' or 'declined'" };
    }
    const review_notes = payload.review_notes || app.review_notes || null;
    const beforeState = { status: app.status, review_notes: app.review_notes };
    const afterState = {
      status: payload.decision,
      review_notes,
      award: payload.decision === 'awarded' ? { amount: payload.amount || null, care_package: payload.care_package || null } : null
    };
    return {
      ok: true,
      current: app,
      projected: { ...app, status: payload.decision, review_notes },
      before: beforeState,
      after: afterState,
      operation: 'decision',
      payload: {
        decision: payload.decision,
        amount: payload.amount || null,
        care_package: payload.care_package || null,
        review_notes
      }
    };
  }

  if (normalizedOp === 'course_complete') {
    if (app.status !== 'awarded') {
      return { ok: false, status: 409, error: `cannot mark course complete from status ${app.status}` };
    }
    const beforeState = { status: app.status };
    const afterState = { status: 'course_complete' };
    return {
      ok: true,
      current: app,
      projected: { ...app, status: 'course_complete' },
      before: beforeState,
      after: afterState,
      operation: 'course_complete',
      payload: {}
    };
  }

  if (normalizedOp === 'close') {
    if (app.status === 'awarded') {
      return { ok: false, status: 409, error: 'awarded grant must be course_complete before closing' };
    }
    if (app.status !== 'course_complete' && app.status !== 'declined') {
      return { ok: false, status: 409, error: `cannot close from status ${app.status}` };
    }
    const award = await db
      .prepare('SELECT id, outcome FROM award WHERE grant_application_id = ?')
      .bind(grantId)
      .first();

    const outcome = payload.outcome || null;
    const beforeState = { status: app.status };
    const afterState = { status: 'closed', outcome };
    return {
      ok: true,
      current: app,
      award,
      projected: { ...app, status: 'closed', outcome },
      before: beforeState,
      after: afterState,
      operation: 'close',
      payload: { outcome }
    };
  }

  return { ok: false, status: 400, error: 'unsupported action' };
}

export async function apply(db, { id, operation, payload = {} }, actor) {
  const v = await validate(db, { id, operation, payload });
  if (!v.ok) {
    return v;
  }

  const grantId = parseInt(id, 10);
  const normalizedOp = v.operation;

  if (normalizedOp === 'review') {
    const { review_notes } = v.payload;
    await db
      .prepare("UPDATE grant_application SET status = 'in_review', review_notes = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(review_notes, grantId)
      .run();

    await db
      .prepare(`
        INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
        VALUES (?, 'grant_application.review', 'grant_application', ?, ?, ?)
      `)
      .bind(actor, grantId.toString(), JSON.stringify(v.before), JSON.stringify(v.after))
      .run();

    return { ok: true, grant: v.projected };
  }

  if (normalizedOp === 'decision') {
    const { decision, amount, care_package, review_notes } = v.payload;

    await db
      .prepare("UPDATE grant_application SET status = ?, review_notes = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(decision, review_notes, grantId)
      .run();

    if (decision === 'awarded') {
      await db
        .prepare('INSERT INTO award (grant_application_id, amount, care_package) VALUES (?, ?, ?)')
        .bind(grantId, amount, care_package)
        .run();

      await db
        .prepare(`
          INSERT INTO followup (caregiver_id, kind, detail, source, external_ref)
          VALUES (?, 'grant_award_delivery', ?, 'staff_console', ?)
        `)
        .bind(v.current.caregiver_id, 'Deliver care package', `grant_award_${grantId}`)
        .run();
    }

    await db
      .prepare(`
        INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
        VALUES (?, 'grant_application.decision', 'grant_application', ?, ?, ?)
      `)
      .bind(actor, grantId.toString(), JSON.stringify(v.before), JSON.stringify(v.after))
      .run();

    return { ok: true, grant: v.projected };
  }

  if (normalizedOp === 'course_complete') {
    await db
      .prepare("UPDATE grant_application SET status = 'course_complete', updated_at = datetime('now') WHERE id = ?")
      .bind(grantId)
      .run();

    await db
      .prepare(`
        INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
        VALUES (?, 'grant_application.course_complete', 'grant_application', ?, ?, ?)
      `)
      .bind(actor, grantId.toString(), JSON.stringify(v.before), JSON.stringify(v.after))
      .run();

    return { ok: true, grant: v.projected };
  }

  if (normalizedOp === 'close') {
    const { outcome } = v.payload;

    await db
      .prepare("UPDATE grant_application SET status = 'closed', updated_at = datetime('now') WHERE id = ?")
      .bind(grantId)
      .run();

    if (v.award) {
      await db
        .prepare("UPDATE award SET outcome = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(outcome, v.award.id)
        .run();
    }

    await db
      .prepare(`
        INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
        VALUES (?, 'grant_application.close', 'grant_application', ?, ?, ?)
      `)
      .bind(actor, grantId.toString(), JSON.stringify(v.before), JSON.stringify(v.after))
      .run();

    return { ok: true, grant: v.projected };
  }

  return { ok: false, status: 400, error: 'unsupported action' };
}
