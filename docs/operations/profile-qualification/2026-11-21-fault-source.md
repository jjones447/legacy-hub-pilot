# Inert fault/race adapter source package

[pc2-codex-ct-13], Nov21 2026. Continues the accepted design at
[381c7063246235](https://github.com/jjones447/legacy-hub-pilot/pull/381#issuecomment-7063246235).
This is source and local causal evidence only. The completed owner fixture remains
disabled; its native revision4/audits213–216/follow-up23 are preserved. No provider,
DDL, owner mutation, new session, activation, or native test is performed by this package.

## Composition and one-use custody

`tests/runtime/profile-hosted-fault-worker.mjs` composes the unchanged portal handlers
and existing exact-origin/window/owner/HMAC fixture boundary with the new test-only
D1 wrapper. `profile-hosted-fault-manifest.mjs` pins **null origin/window/operation**.
The compiled artifact returns403 before environment/capability access. No request
can choose a hook, owner, operation, revision, SQL, recovery mode or active window.
Product functions, schema0022, site allowlist, normal login, preview mail, staff
identity and production are unchanged. A fixed operation permits only contact-Yes
with otherwise byte-equivalent normalized prior answers, so another form update
cannot consume the operation. This is not a customer login or full-portal route.

`profile-hosted-faults.mjs` exports the exact test-ledger DDL, audit-trigger DDL,
`createProfileFaultDb`, `profileFaultWitness` and cleanup-only `recoverProfileFault`.
The ledger is a **new proposed additive TEST-only table/index**, not installed and
not a product migration. Its primary operation key prevents replay; a partial unique
owner index blocks a different operation while earlier owner custody is unresolved.
Claim uses INSERT, never UPSERT/REPLACE/reset. A claim with missing/lost acknowledgement
is spent/UNKNOWN and does not proceed. A reconstructed wrapper cannot resume it.
The private before-witness contains the entire exact caregiver, Profile, audit and
follow-up rows; source-pinned digests must match before injection or cleanup.

Supported candidate operands are retained fictional A atrevision4 and B with no
Profile row. Audit uses A4 only. Archive tests use distinct A4 and B0 operands and
never create/reset A's prior answers. Separate exact operation manifests would be
required; this package does not select or activate any of them.

## Injection and recovery behavior

- Audit: native D1 batch would atomically assert the exact claimed ledger ticket and
  absent trigger, CREATE the narrowly scoped trigger, and mark ownership injected.
  Only a known complete acknowledgement permits the unchanged product batch. The
  expected audit error must roll back Profile and follow-up. Cleanup atomically
  checks the exact trigger name/type/definition and operation ticket **inside the
  same batch before DROP**, then records cleaned. A changed object is not dropped.
- Archive: native D1 batch would guard the full caregiver preimage, current Profile
  revision and ledger ticket, change only this fictional owner's status, and record
  injected only if the guarded change happened. A zero/missing/ambiguous transition
  never dispatches the product batch. The unchanged product's current eligibility
  predicate must yield no changes/409. Restoration compares every original caregiver
  column except the owned archived status; it refuses intervening drift.
- Lost CREATE/transition acknowledgement goes directly to finally cleanup without
  original-batch dispatch. Ledger state distinguishes owned committed effects from
  an unperformed or foreign mutation. Unknown DROP/restore is reconciled once from
  the original state, not blindly repeated. Failed cleanup remains durable injected
  state, stops the request, and blocks subsequent attempts.
- Cleanup-only restart reads the pinned original witness and operation state. It
  cannot replay the original request, CREATE another trigger or re-archive a person.
  Cleaned state is accepted only after trigger absence and complete witness equality;
  altered stored witness/digests or caregiver drift fail closed. No whole-DB restore,
  Profile rollback edit, audit deletion or secret rotation exists in this adapter.

SQLite's failing CASE/integer-overflow assertion is used as a transaction guard
before DDL. These local tests establish SQLite semantics; actual D1 transactional
DDL/metadata behavior is **not yet qualified**. Native preflight must establish that
capability before any request, and cannot infer it from these tests.

## Local causal coverage

The new tests run the unchanged portal handler through the hosted boundary with an
in-memory SQLite D1 adapter. They cover initial/existing revision fencing, audit
rollback including contact follow-up, signature/owner/body/origin/query refusals,
fixed-payload refusal, durable duplicate/alternate-operation refusal, lost claim and
injection acknowledgements, committed-but-unknown cleanup, changed trigger before
and between inspection/removal, lost custody, full witness drift, zero-change
transition, caregiver drift, cleanup-only restart, and corrupted recovery witness.
The compiled fault artifact is separately tested to deny without capability access.
Neither the SQLite adapter nor the local fault hooks are a native/provider witness.

## Native readiness remains separate

Before proposing an active successor, the SAME retained reviewer must assess this
exact source plus the new ledger schema and executor semantics. Then the existing
executor must qualify collision-free ledger/schema setup, actual TEST identity and
an exclusively controlled alias, fresh complete synthetic witnesses/digests, a private
cleanup-only execution carrier, and native transactional DDL behavior. The cleanup
function is source-complete, but no installed private recovery carrier is claimed.
Do not expose recovery through HTTP or widen the product's staff/portal identity.

Proposed **earliest follow-on window: Nov21 16:00–17:00UTC**, conditional on exact
active manifest review, supported native capability and recovery custody. It is not
accepted/armed, and must be replaced rather than silently extended if readiness is
missing. Each fixed operation needs its exact operand/digest and original-operation
receipt; completed fixture writes are never repeated. At end restore verified inert
bytes, confirm refusal and unchanged witnesses, and retain the ledger/evidence.

Customer entry has priority. This fault package does not solve Shanelle's ordinary
TEST login/save delivery. The historical staging hostname maps to production106ce7c5
and productionD13c06c3cb; do not use it as TEST. The existing Lead4→GUI3 route owns
legitimate TEST mapping/customer identity/mail disposition. No new custodian wake,
real-mail enablement, production session, fake actor or customer/account ask is made.
