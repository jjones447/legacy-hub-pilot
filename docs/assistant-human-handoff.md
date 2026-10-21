# Assistant request to verified staff handoff — source successor

[pc2-codex-42] October 15. This implements the missing app-side seam described
in the existing agent architecture and private canonical issue54 assessments
6198018497/6198061012. It extends the existing five-area mapper, staff middleware,
confirmation/discard handlers and original audits; it is not a second agent,
mapper, authentication provider, model confirmation tool or gateway writer.

**Source only.** No migration, secret, account, target, listener, Slack reply,
native runtime, build or deployment is installed by this source. Lead13 owns
review/integration and the qualified isolated acceptance target. Codex17 owns the
later existing-company-gateway hook. Current production/staging pins are not this
feature's installed evidence. The old compiled22-route package cannot acquire new
routes through configuration: the integrated successor needs its own qualified
build/install/live check, not another compiler or static-only upload.

## Opt-in deployment contract

Default is disabled. Do not put real values in source or modify the existing
shared preview/production configuration. Root qualifies these on the dedicated
noncustomer acceptance application only:

| Setting | Contract |
|---|---|
| `ASSISTANT_HANDOFF_ENABLED` | Exactly `1` only after migration, target, host and identity custody qualify |
| `ASSISTANT_APP_ORIGIN` | One exact HTTPS origin, no path/query/credentials; both routes require it |
| `ASSISTANT_WORKSPACE`, `ASSISTANT_CHANNEL` | Exact existing authorized company workspace/private channel |
| `ASSISTANT_TARGETS_JSON` | Bounded5–128 server-owned records; all five areas, unique area/target pairs, fixed existing IDs, never model arguments |
| `ASSISTANT_INTAKE_SECRET` | New dedicated purpose-bound HMAC secret, at least32 characters, held only by trusted gateway and application; not an Access/staff credential |
| `LEGACY_DB` | Exact qualified noncustomer database; includes explicit candidate migration below |
| Access team/AUD, active staff | Existing verified middleware contract, normal current human admission; no dev/service substitute |
| `ENVIRONMENT=preview` | Keeps caregiver portal and transactional email disabled; does NOT disable staff/agent routes |

Initial acceptance catalog has exactly five entries. Additional explicit existing
targets per area are supported, never a wildcard or automatic customer enumeration.
Target catalog shape (fictional IDs only, NOT a provisioning command):

```json
[
  {"area":"content","target_id":"ps_home.hero","type_id":"page_section"},
  {"area":"forms","target_id":"ps_form.request_support","type_id":"page_section"},
  {"area":"caregiver","target_id":"cg_synthetic"},
  {"area":"event","target_id":"ev_synthetic"},
  {"area":"grant","target_id":"2"}
]
```

Allowed deltas are deliberately narrow: Content title; Forms name_label;
Caregiver segment_tags; Event title (not publication); Grant status/review_notes
(review only). Other original request/model deltas retain HOLD before approval.
Grant IDs must be the actual returned canonical positive integer string, not the
example2. The existing draft handler now explicitly stringifies resolved target
IDs before storage, avoiding numeric-to-TEXT formatting drift; historical rows
are not normalized, repaired or adopted.

`schema/candidates/0015_assistant_handoff.sql` is an explicit opt-in migration.
It is excluded from the active migration/backup catalog, which remains0014.
It creates pending intent/transport state, NOT an audit table or audit surrogate.
Do not apply it to customer/shared data or blindly replay historical migrations.
No cleanup, retention job, automatic retry or schedule is introduced. Deployment
must qualify retention of original request text in this private state; acceptance
fixtures contain no customer/contact/health text. Existing audit history is untouched.

## Dedicated machine boundary

`POST /api/assistant-intake` is outside the human `/api/agent/*` prefix and has
its OWN mandatory purpose-bound HMAC verification. Human middleware is unchanged,
not bypassed or broadened. Browser Origin-bearing requests refuse. Raw UTF-8 body
is bounded to16KiB before JSON parse. No request/error contents are logged.

Headers: `x-legacy-timestamp` is a13-digit Unix millisecond timestamp within60
seconds; `x-legacy-signature` is lower-case hex HMAC-SHA256 over these UTF-8 bytes:

```text
<timestamp>\n<exact configured HTTPS origin>\nPOST\n/api/assistant-intake\n<lowercase SHA256 of exact raw UTF-8 JSON body>
```

WebCrypto `verify` checks the signature. Timestamp/origin/method/fixed path/body hash
are bound. Origin/path/query mismatch, wrong signature, stale timestamp, unknown
fields or unconfigured target refuse. The timestamp is not sufficient replay
protection: original delivery identity and one-use verification state also bind it.

Exactly three actions exist:

- `intent`: action/delivery_id/workspace/channel/thread/user/area/target_id/request.
  Gateway obtains authoritative Slack metadata OUTSIDE model arguments. It must
  reject bot/self-generated events and restrict the existing company channel.
  Request text is bounded4000 characters and treated as data. A delivery with
  identical canonical intent returns the SAME handoff; a changed intent conflicts.
- `verify`: action/handoff_id/event_id/workspace/channel/thread/user/challenge.
  Only the EXACT original Slack author/thread/workspace/channel and live code may
  pair. Verification-event identity is unique; consumed codes cannot rebind.
- `outcome`: action/handoff_id. Read-only, content-free state + original audit IDs
  + immutable original workspace/channel/thread/delivery correlation. No staff
  email, challenge, request, before/after or authority is returned.

The secret admits only these actions. There is no machine draft, claim, confirm,
discard, direct edit, audit mutation, target URL or tool/credential getter. Do not
reuse an Access service token as this secret. No secret was generated/read here.

## Real two-channel pairing and human action

Gateway may offer only the configured `/staff#handoff=<opaque ah_ ID>` link. No
request text/email/token/preview goes in a URL. ID is a locator, NOT a bearer grant.
The UI removes the fragment from browser history and renders text with textContent,
not request-derived HTML. Only verified active Access staff plus same-origin POST
may use `/api/agent/handoff`.

1. Human explicitly selects Begin identity pairing. One CAS claims pending intent
   for that Access actor and creates a CSPRNG128-bit one-use code. Only its SHA256
   is stored. Code is displayed ONCE on that protected page, expires in3 minutes,
   and is never returned by machine outcome/view. Lost code/unknown claim needs
   operator reconciliation, not a new claim/code or automatic retry.
2. Human personally posts that code in the ORIGINAL Slack request thread. Gateway
   consumes that verification event BEFORE model dispatch and forwards actual event
   metadata to verify. **Never put the code into a model prompt/context, log,
   assistant tool result or a different thread.** Existing scopes suffice; no new
   Slack OAuth grant is assumed. Gateway implementation/custody is a later17 task.
3. After pairing, the same staff actor reads the original request and explicitly
   creates a NEW draft through the existing HUMAN application context. No service
   draft is adopted. The durable row reserves drafting before inference and binds
   the actual persisted ID, server preview/version and target snapshot. One current
   draft per handoff; it cannot be replaced by repeat delivery or another actor.
4. Human inspects exact server before/after and explicitly confirms OR discards.
   Only ID+original preview_version goes to the existing internal handler—no forbidden
   Slack thread fields, fake staff_id, injected SQL or model confirmer. New source
   uses the current guarded discard successor as well as source204 confirmation.
5. Controller durably reserves confirming/discarding BEFORE the existing handler.
   Independently read actual result and ORIGINAL actor/action/entity/ID/before/after
   audits before recording terminal success. Event/Grant do not rely on the staff
   Recent changes view. No synthetic audit is inserted to manufacture evidence.
6. Gateway later sends ONE correlated reply using ONLY the stored original thread
   and verified terminal receipt. This source does not install that writer or prove
   its durable delivery dedup. Re-reading outcome does not authorize duplicate sends.

The protocol demonstrates possession/intent across two channels under the trusted
gateway assumption; it is not phishing/relay-proof or a detector of physical-human
interaction. Staff must not forward codes or let an AI post/approve them. Simulated
browser clicks or fake JWT context in tests are NOT real-human acceptance.

## Durable HOLD / failure contract

Pending intent expires after15 minutes. Claim, pairing and mutations use state
CAS. An interrupted drafting/confirming/discarding state or explicit HOLD survives
restart and refuses replacement, repeat, discard and automatic recovery. Errors
do not imply no commit: an existing-handler batch may have committed before its
acknowledgement failed. The controller returns HOLD with no success audit IDs;
an operator must reconcile actual app result/original audits under a separate
bounded scope. There is no reset endpoint, new-session retry, undo/backfill or
model instruction that clears it.

Pure tests explicitly model committed mutation + lost acknowledgement, readback
failure despite an original audit, concurrent draft clicks, terminal duplicates,
cross-user/thread/actor/origin/target/expiry failures, HMAC body tampering and code
reuse. Original handlers retain their audit batches; this is not global CAS or
native D1 concurrency proof. An independent target change after readback can still
make a later observation differ; no all-database snapshot claim is made.

Trusted internal agent calls use a server-context-only `redactErrors` option so
raw provider/database exception details do not enter logs. Normal external API
contracts are unchanged; the option is not read from request JSON. No new raw text
diagnostic mode or secret logging is introduced.

## Verification / remaining release work

Author Node26.2:57 new source tests PASS; full explicit unit-only suite1585 PASS,
0 failures/skips. Initial source tests caught Grant target formatting (34/36),
corrected before the passing set. Initial active migration placement changed the
backup catalog and failed four expectations; moving the explicit candidate OUT of
the active catalog restored compatibility WITHOUT weakening those tests. No held
native/workerd runtime, provider call or migration ran.

Before live proof: independent whole-head review; normal CI/merge composition
with the stacked discard fix; exact qualified build; isolated schema/config/Access
installation;17 gateway signing/filtering/handoff/outcome integration; real staff
pairing+five previews+human approval/discard; original audit/consumer propagation,
refusal and uncertain-outcome checks; designated handoff. No source/test result is
production/client acceptance, and no already verified website package is silently
replaced. Lead13 remains canonical writer; Projects18/Word14, exact holds,
runtime/photo custody, schedules and reminders OFF are preserved.

Primary implementation references:
[D1 batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch),
[WebCrypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).
