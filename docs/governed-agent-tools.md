# Governed application tools: source adapter

[pc2-codex-41] This module extends the existing `/api/agent` application contracts.
It implements **draft, retained preview, and staff-authorized discard** for Content,
Forms, Caregiver, Event and Grant targets. It is not wired into the Slack seat,
an HTTP route, a listener, or an authentication service. Nothing here installs or
enables application tools. Private source104's answer-only seat instructions stay
accurate until a separate integration is qualified.

The design follows private `docs/architecture/agent.md`, the slice07 API-first
editing loop, and source100's five-area fixture packet. Code belongs in the public
application beside its existing agent mechanisms. Lead13 owns integration/release;
the original GUI3 operator owns transport. This source delivery creates no second
runtime operator, framework, account or credential.

## Contract and mapped fields

Import `createGovernedAgentTools` from `functions/_lib/governed-agent-tools.mjs`.
Construct one session from **trusted host code**, never from a model tool call.

| Input | Contract |
|---|---|
| `scope` | Qualified application ID, actual staff actor ID, and original thread ID |
| `targets` | Independently qualified existing target catalog: area, exact ID, content type where applicable, approved editable fields, and content's last-loaded application data |
| `authorize` | Independently verify current staff identity/authority and exact human intent; return a private capability with `actorKind: staff`, exact scope and intent, or refuse |
| `transport` | Inject the existing authenticated application transport; use only the fixed method/path/body supplied by the adapter; enforce target origin, redirect refusal and bounded JSON parsing outside model control |

No JWT, staff ID, service token, URL or headers can be supplied through tool
arguments. Capability credentials never enter a request body or model result.
The module does **not** implement `authorize` or a Slack-to-Access identity mapping.
Returning the adapter's intent verbatim from `authorize` is not production authority:
the tests do that only as a fictional capability seam. Missing qualification means
no usable adapter, not fallback to a dev actor or service identity.

The model sees exactly three format-neutral definitions:

| Tool | Model fields | Existing application mapping |
|---|---|---|
| `app_draft` | `area`, `target_id`, `request` | Content/Forms: `/api/agent/draft` with trusted `type_id`, `target_id`, `request`. Caregiver/Event/Grant: `/api/agent/change/draft` with `area`, `target_id`, `request`. |
| `app_preview` | `draft_id` | Reads only this session's retained original application draft/preview; does not list other drafts or send a request. |
| `app_discard` | `draft_id` | Content/Forms: `/api/agent/discard` with `draft_id`. Other areas: `/api/agent/change/discard` with `change_id`. Requires exact independently established staff discard intent. |

`draft_id` is the adapter's common handle, retaining the actual application
`draft_id` or `change_id`; the wire contract keeps those keys distinct. No target
creation, direct mutation, role/sensitivity routing, schema update, payment, secret,
audit editing or confirming tool is admitted. Unknown arguments are refused.
Only canonical existing grant IDs are accepted; no `parseInt` suffix admission.

A success binds the returned ID to target, content type/area, original request,
actor, application, thread and exact preview. Target mismatches, missing previews,
unapproved changed fields, or re-used IDs require HOLD: an application draft may
already exist. It is never replaced or automatically discarded.

Content before-data is the trusted last-loaded application snapshot, just as in
`staff.js`; it is not an invented server before-image or concurrency lock. After
is the original server draft data. Workflow before/after come from the server's
preview and must match its change object. This module returns the original app
response separately as `application`; adapter lifecycle labels are bookkeeping,
not app-original results/audits or evidence that a change is live.

## Separate staff confirmation remains unavailable

The original PR203 application contract accepted an ID behind Access. It did not establish
the required same-requester, same-Slack-thread, exact-preview human capability.
Access service-token admission is not a human's confirmation. Every attempt to call
confirm/direct through this adapter is refused; there is no injected confirm transport
route and no `staff_id` or fake audit field to bypass that decision.
Source204's separate console caller now binds the initiating human and server
preview version; it still does not establish the Slack-to-staff capability here.

Before a separately qualified staff confirmer sends anything, trusted host code must
call `holdForReconciliation()`. This one-way latch blocks all adapter operations,
including discard, replacement and repeat delivery. It also blocks a write whose
authorization is still awaiting a response. No model tool can clear it. Reconciliation
and any later session require an operator to establish actual app outcome, not simply
construct another adapter. The module never reports a confirmed/live result or writes
an audit. The October15 discard successor requires the original application
`preview_version` and initiating verified human on both discard routes. The
adapter retains that version privately from the original draft response and
sends it on discard, not as a model argument or independent human-intent proof.
New Content discard audits use the verified actor; historical literal `staff`
audits remain unchanged. No deployed or named-human runtime acceptance follows
from this source correction.

## Delivery identity and uncertain outcomes

The host supplies `callId` separately to `execute(name, args, callId)`. Use a stable
trusted delivery/tool-call identity, not a model argument. Same-ID/same-input concurrent
or sequential calls await the same attempt. Same-ID/different-input refuses. Different
concurrent mutations cannot race, and an outstanding draft prevents replacement.

This is **session-local dedup**, not durable exactly-once semantics. The host must
preserve session ownership/HOLD across wakes and restarts or stop for reconciliation;
do not recreate a session to retry. In-memory promises are not an application receipt.
The 100-call bound refuses further calls rather than evicting and enabling old repeats.

Thrown transport errors, HTTP errors, malformed application replies, missing identity/
preview or post-response parsing failures latch HOLD. There is no retry. An explicit
200 application draft refusal is returned as original refusal evidence without claiming
a persisted draft. An uncertain discard cannot become a replacement draft.

## Verification and remaining release gates

The focused tests use only fictional source100-style targets and inert injected
capability/transport functions. They test all five mappings, exact staff discard intent,
arbitrary IDs, cross-scope authority, forged model fields, preview/target drift,
sequential/concurrent duplicates, conflicts, malformed replies and uncertain confirmation/
discard holds. The grant77 test ID is fictional, not a provisioned record. The new pure
test is in `scripts/unit-test-files.mjs`; the existing workerd harness is unchanged.

Before installation, separately qualify the actual application target/bindings/schema,
current staff actor and Slack mapping, authenticated bounded transport and retained
session lifecycle. Full confirm/result/original-audit propagation for all five workflows
still needs a governed trusted human-confirmation mechanism and runtime acceptance.
No source test clears native/served/company/Cloudflare holds, provisions the fixture,
or proves live Slack/application behavior.
