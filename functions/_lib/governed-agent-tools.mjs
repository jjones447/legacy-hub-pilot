// Caller-side adapter for existing /api/agent routes, not a route or authenticator.
// The host supplies qualified staff/target capabilities and an authenticated transport.
// Never expose the constructor, authorize, transport or HOLD latch as model tools.

/** @typedef {'content'|'forms'|'caregiver'|'event'|'grant'} Area */
/** @typedef {{applicationId:string, actorId:string, threadId:string}} Scope */
/** @typedef {{area:Area,targetId:string,typeId?:string,before?:object,fields:string[]}} Target */
/** @typedef {{action:'draft',area:Area,targetId:string,request:string}|{action:'preview'|'discard',area:Area,targetId:string,draftId:string,request:string,preview:{before:object,after:object}}} Intent */
/** @typedef {{actorKind:'staff',scope:Scope,intent:Intent}} Capability */
/**
 * @typedef {{scope:Scope,targets:Target[],
 * authorize:(intent:Intent&{scope:Scope})=>Promise<Capability|null>,
 * transport:(capability:Capability,request:{method:'POST',path:string,body:object})=>Promise<{status:number,body:object}>}} Options
 */

const AREAS = Object.freeze(['content', 'forms', 'caregiver', 'event', 'grant']);
const plain = value => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 4000;
const clone = value => structuredClone(value);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const refused = reason => ({ ok: false, state: 'refused', reason });
const held = () => ({ ok: false, state: 'hold', reason: 'operator_reconciliation_required' });
const content = area => area === 'content' || area === 'forms';
function freezeTree(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeTree);
    Object.freeze(value);
  }
  return value;
}

// Format-neutral tool descriptions. They grant no authority and carry no credentials.
export const GOVERNED_TOOLS = freezeTree([
  { name: 'app_draft', description: 'Draft a change to a known target; never publish.',
    parameters: { type: 'object', properties: {
      area: { type: 'string', enum: AREAS }, target_id: { type: 'string', minLength: 1 },
      request: { type: 'string', minLength: 1, maxLength: 4000 },
    }, required: ['area', 'target_id', 'request'], additionalProperties: false } },
  { name: 'app_preview', description: 'Read the exact retained application preview for this draft.',
    parameters: { type: 'object', properties: { draft_id: { type: 'string', minLength: 1 } },
      required: ['draft_id'], additionalProperties: false } },
  { name: 'app_discard', description: 'Discard only after trusted staff intent for this exact preview.',
    parameters: { type: 'object', properties: { draft_id: { type: 'string', minLength: 1 } },
      required: ['draft_id'], additionalProperties: false } },
]);

/**
 * One adapter per qualified application/staff/thread session. No global request state.
 * authorize MUST independently resolve current staff authority and human intent; it
 * must never echo model input as proof. Its opaque transport credential stays private.
 * The returned capability must contain actorKind:'staff', the exact scope, and intent.
 * No Slack-to-Access identity mapping or staff-confirm mechanism is implemented here.
 * @param {Options} options
 */
export function createGovernedAgentTools({ scope, targets, authorize, transport }) {
  if (!plain(scope) || !Object.keys(scope).every(key => ['applicationId', 'actorId', 'threadId'].includes(key))
      || !['applicationId', 'actorId', 'threadId'].every(key => text(scope[key]))
      || /^(service:|anonymous_staff$|unknown_staff$|invalid_jwt_staff$)/.test(scope.actorId)
      || !Array.isArray(targets) || typeof authorize !== 'function' || typeof transport !== 'function') {
    throw new TypeError('Qualified caller scope, target catalog and capability seams required');
  }
  const bound = clone(scope);
  const catalog = targets.map(target => {
    if (!plain(target) || !AREAS.includes(target.area) || !text(target.targetId) || target.targetId === 'new'
        || !Array.isArray(target.fields) || !target.fields.length || !target.fields.every(text)
        || (content(target.area) && (!text(target.typeId) || !plain(target.before)))
        || (target.area === 'grant' && !/^[1-9][0-9]*$/.test(target.targetId))) {
      throw new TypeError('Existing qualified targets and approved fields required');
    }
    return clone(target);
  });
  if (new Set(catalog.map(target => `${target.area}:${target.targetId}`)).size !== catalog.length) {
    throw new TypeError('Ambiguous target catalog');
  }
  let hold = false;
  let busy = false;
  let draft = null;
  const calls = new Map(); // Session dedup only; not a durable application receipt.
  const seenDraftIds = new Set();

  async function capability(intent) {
    try {
      const cap = await authorize(clone({ ...intent, scope: bound }));
      if (!plain(cap) || cap.actorKind !== 'staff' || !same(cap.scope, bound) || !same(cap.intent, intent)) return null;
      return cap; // Never returned to the model or placed in a request body.
    } catch { return null; }
  }

  function previewFrom(body, target) {
    if (!plain(body) || body.ok !== true) return null;
    if (content(target.area)) {
      if (!text(body.draft_id) || !plain(body.draft) || body.draft.id !== body.draft_id
          || body.draft.status !== 'draft' || body.draft.type_id !== target.typeId
          || body.draft.draft_of !== target.targetId || !plain(body.draft.data) || !plain(body.preview)) return null;
      return { id: body.draft_id, before: target.before, after: body.draft.data };
    }
    if (!text(body.change_id) || !plain(body.change) || body.change.id !== body.change_id
        || body.change.area !== target.area || String(body.change.target_id) !== target.targetId
        || body.change.status !== 'draft' || !plain(body.preview)
        || !plain(body.preview.before) || !plain(body.preview.after)
        || !same(body.preview.before, body.change.before) || !same(body.preview.after, body.change.after)) return null;
    return { id: body.change_id, before: body.preview.before, after: body.preview.after };
  }

  async function perform(name, args) {
    if (hold) return held();
    if (busy) return refused('another_operation_pending');
    const target = name === 'app_draft'
      ? catalog.find(item => item.area === args.area && item.targetId === args.target_id) : draft?.target;
    if (!target) return refused('unknown_target_or_draft');
    if (name !== 'app_draft' && (!draft || args.draft_id !== draft.id || draft.state !== 'draft')) {
      return refused('unknown_or_terminal_draft');
    }
    if (name === 'app_draft' && draft?.state === 'draft') return refused('discard_or_staff_review_required');
    const intent = name === 'app_draft'
      ? { action: 'draft', area: target.area, targetId: target.targetId, request: args.request }
      : { action: name === 'app_preview' ? 'preview' : 'discard', area: target.area,
        targetId: target.targetId, draftId: draft.id, request: draft.request, preview: draft.preview };
    // Reserve before awaiting admission so different concurrent calls cannot both write.
    busy = true;
    try {
      const cap = await capability(intent);
      if (!cap) return refused('staff_or_intent_not_qualified');
      if (hold) return held(); // External confirmation may have become uncertain while awaiting auth.
      if (name === 'app_preview') return clone({ ok: true, state: 'draft', ...draft.evidence });
      const path = name === 'app_draft'
        ? (content(target.area) ? '/api/agent/draft' : '/api/agent/change/draft')
        : (content(target.area) ? '/api/agent/discard' : '/api/agent/change/discard');
      const body = name === 'app_draft'
        ? { ...(content(target.area) ? { type_id: target.typeId } : { area: target.area }),
          target_id: target.targetId, request: args.request }
        : { [content(target.area) ? 'draft_id' : 'change_id']: draft.id };
      let response;
      try { response = await transport(cap, { method: 'POST', path, body }); }
      catch { hold = true; return held(); }
      if (hold) return held();
      // HTTP/parse/server uncertainty can follow a persisted write. Never infer rollback.
      if (!plain(response) || response.status !== 200 || !plain(response.body)) { hold = true; return held(); }
      const original = clone(response.body);
      if (original.ok === false && (typeof original.refusal === 'string' || typeof original.error === 'string')) {
        if (name === 'app_discard') { hold = true; return held(); }
        return { ...refused('application_refusal'), application: original };
      }
      if (name === 'app_discard') {
        if (original.ok !== true) { hold = true; return held(); }
        draft.state = 'discarded';
        return { ok: true, state: 'discarded', draft_id: draft.id, application: original };
      }
      const preview = previewFrom(original, target);
      if (!preview || seenDraftIds.has(preview.id) || Object.keys({ ...preview.before, ...preview.after }).some(key =>
        !same(preview.before[key], preview.after[key]) && !target.fields.includes(key))) {
        hold = true; return held(); // Draft may exist: no replacement or automatic discard.
      }
      const evidence = { draft_id: preview.id, preview: { before: preview.before, after: preview.after }, application: original };
      draft = clone({ id: preview.id, target, request: args.request, preview: evidence.preview, state: 'draft', evidence });
      seenDraftIds.add(preview.id);
      return clone({ ok: true, state: 'draft', ...evidence });
    } catch {
      // A malformed/uncloneable application response may follow a successful write.
      hold = true;
      return held();
    } finally { busy = false; }
  }

  /** callId is a trusted host delivery/tool-call identity, never a tool argument. */
  function execute(name, args, callId) {
    if (hold) return Promise.resolve(held());
    if (!['app_draft', 'app_preview', 'app_discard'].includes(name)) return Promise.resolve(refused('tool_not_allowed'));
    const keys = name === 'app_draft' ? ['area', 'target_id', 'request'] : ['draft_id'];
    if (!plain(args) || !same(Object.keys(args).sort(), [...keys].sort()) || !keys.every(key => text(args[key]))
        || (name === 'app_draft' && !AREAS.includes(args.area)) || !text(callId)) {
      return Promise.resolve(refused('invalid_arguments'));
    }
    const input = clone(args);
    const fingerprint = JSON.stringify(canonical({ name, args: input }));
    if (calls.has(callId)) {
      const prior = calls.get(callId);
      if (prior.fingerprint !== fingerprint) return Promise.resolve(refused('call_identity_conflict'));
      return prior.result.then(clone); // Await same attempt; never resubmit uncertain transport.
    }
    if (calls.size >= 100) return Promise.resolve(refused('session_capacity_reached'));
    const result = perform(name, input);
    calls.set(callId, { fingerprint, result });
    return result.then(clone);
  }

  return Object.freeze({
    tools: clone(GOVERNED_TOOLS), execute,
    // Trusted host calls BEFORE a separate staff confirmation leaves its control, or
    // on any uncertain outcome. No reset: reconciliation requires a qualified new session.
    holdForReconciliation() { hold = true; return held(); },
  });
}
