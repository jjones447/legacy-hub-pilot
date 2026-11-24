# Verified-owner Request Support — candidate contract

Author pc2-codex-ct-5. Source planning only; no route, persistence or activation in this increment. The approved #378 presentation remains a donor, not functional delivery. This branch starts at main `3eaf20f`; it is NOT the selected TEST baseline. Final composition must use ct13's then-current #381 TEST successor, preserving its separate Profile page. No portal.html/app.js/styles.css/portal dispatcher edits are claimed here.

## Delivered boundary

The pure contract accepts exactly request_id, needs, preferred_contact and optional message. Five existing options remain distinct (break, care, connect, resources, unsure). Text is a saved preference, not consent to send SMS or proof of a provider. Caller name/email/phone/actor/owner/status are rejected. Identity and available contact details must come from the verified current caregiver server context; if the selected method has no usable existing address/number, return a bounded action-needed response rather than silently switching methods or upserting a caregiver. Profile correction links use ct13's supported page. Never duplicate Profile fields in this request writer.

Values are bounded, typed, canonically ordered and copied; duplicate/sparse/unknown/accessor-backed options fail. This pure function is NOT authentication or a substitute for HTTP byte limits/JSON parsing. Only JSON input from the bounded route will reach it. All candidate test files are registered in the explicit unit inventory. The runner classification guard remains unchanged.

## Proposed additive persistence, not applied or approved schema

One dedicated `portal_support_request` row: opaque server id; verified caregiver_id FK; caller request_id; canonical payload/digest; needs JSON array with reviewed bounds; preferred_contact enum; bounded message; explicit status; revision; created/updated timestamps. Unique (caregiver_id, request_id). No new caregiver or participant entity. Do not copy contact addresses or private request text into audit metadata. Existing Staff followup should reference this row through an additive association rather than parsing its free-text detail. Confirm exact current schema/migration number with ct13; no number reserved here.

Create request + corresponding existing Staff task + original metadata-only audit + idempotency receipt in one qualified atomic transaction/batch. A matching retry returns the original receipt; different payload with same key conflicts. Active owner must be checked at write time, not only before awaiting a query. Failures roll back every row; lost acknowledgment retries must not duplicate tasks. A supplied actor is never authority. Exact D1 batch rollback/CAS semantics require inert and native TEST qualification before enablement.

Readback queries by server-verified caregiver id and nonarchived-owner predicate, excludes foreign rows, bounded pagination, no shared QA samples. Authentication/CSRF must reuse the selected current portal implementation: verified session, current nonarchived caregiver, same-origin check, strict allowed method/path/query and bounded JSON body. Missing or old schema fails closed. No public /api/intake or generic registration mutation is reused.

## Proposed explicit status contract

Owner labels are Received / In Review / Followed Up / Closed. Legacy followup open/done/dismissed cannot prove these states. New requests start Received. Proposed Staff-only transitions are Received→In Review; In Review→Followed Up or Closed; Followed Up→In Review or Closed. Closed is terminal in this candidate. These transitions are a proposed implementation contract for retained review, not a claim that a Staff operating policy has been accepted. An unrecognized/legacy status has no mapped owner label; UI must say progress is unavailable rather than invent history. No hidden backfill of old followups.

Staff decisions require current active Staff authorization at write/projection time, exact row revision CAS and metadata-only audit in the same transaction. Owners cannot post status fields. Display actual recorded timestamps only; do not manufacture milestones or promise Text notification delivery. New tables/status projection must preserve existing Staff tasks and owner history.

## Lifecycle and operating dependencies

Collection scope is a support request linked to an existing caregiver. Retention duration, active removal vs restricted audit/backup retention, authorized exports and restore suppression remain explicit unresolved operating dependencies, not invented policies. A proposed removal ledger must prevent a backup restore from reviving removed visible request text; authorized bounded exports need field-level scope and spreadsheet injection handling. No erasure of existing records follows from hiding grant/social cards. No provider, mail or SMS action is part of this candidate.

## Work sequence and schedule

1. Nov24 noon: contract/candidate increment and baseline/operator readiness assessment (accepted author checkpoint). Current increment delivers pure validation/status proposal and an inert unnumbered SQL candidate; writer/routes/UI are unbuilt.
2. Nov25 noon: separately bounded #369 source reconciliation, not a full respite registration promise.
3. Nov26 noon: accepted full functional #378 source candidate with owner route/writer/Staff projection and coordinated warm UI patch, tests and migration proposal. Shared Profile intersections serialize through ct13.
4. Nov27 18: conditional E2E TEST target. Devin4 accepted review within4–6h of actual complete exact-head delivery and one successor within2–3h; it is not approval and conflicts must be surfaced. Lead41 coordinates ct13 integration and GUI5 operator readiness. No reviewer/operator acceptance is inferred beyond that explicit review turnaround.

The named isolated browser + authorized inbox readiness remains an external dependency, not resolved by this source artifact or customer's Profile-save report. Reuse actual accepted evidence when available; do not replay a login/mail probe. Review, compatible migration backup/bookmark, deployment and own-inbox runtime acceptance stay separate. This PR grants none of those actions. No unconditional customer date or full-candidate claim.

## Candidate SQL qualification

schema/candidates/portal_support_request.sql is an unapplied storage proposal, not a migration allocation. Six in-memory Node SQLite tests exercise distinct options/Text, current active owner and task association, malformed JSON/duplicate options, immutable identity/payload, revision/status guards, foreign-owner CAS and transaction rollback. These are native local SQLite tests, not D1 batch qualification, route authorization, retention/removal implementation, or atomic writer/audit proof. The writer must still bind verified actor and expected revision; SQL integrity guards do not identify Staff or authorize requests. No table or fixture was applied to TEST/production.

## Candidate create/read store increment

Dedicated portal-support-request-store.mjs now composes a proposed atomic batch for existing-owner request + matching Staff followup + metadata-only audit. It reconciles matching idempotency keys/lost acknowledgments, conflicts on changed payload, bounds owner history to50 and filters archived/foreign owners. No raw request text/contact address is copied into audit. Missing contact details require a Profile correction rather than fallback. This module accepts server-context ownerId, which is NOT authentication; it is unmounted, and the authenticated current portal route remains unbuilt. Six local SQLite-backed batch-adapter tests cover create/read/retry, foreign-owner isolation, revocation between lookup/write, audit rollback, lost acknowledgment and missing contact. Actual D1 batch representation/atomicity and concurrency remain unqualified. Staff status mutation and immutable task association across existing Staff writers still require composition checks. No changes to shared dispatcher/Profile UI, migration apply or route activation.

## Selected integration seam — Nov24 intake

Ct13 confirmed381 `88461422e6a7aa1ff8ec862dda59aabf3a45eae9` as the selected source baseline for composition (not proof of installation). The existing parseSessionCookie/hasNonarchivedCaregiver remain module-private. Eligibility is nonarchived, including inactive, so the candidate SQL/store now rechecks that same rule at write time. Do not tighten it silently to active-only. Ct13 owns a serialized dispatcher patch that authenticates the session, current caregiver, strict Origin/JSON checks and passes only the server-derived owner ID; browser actor/email is never used. No duplicate parser or weaker legacy absent-Origin check. My branch retains dedicated module ownership, not shared dispatcher/Profile hunks. Conditional ct13 integration reservation Nov27 14:00–18:00 requires accepted green input by14:00 and own-inbox/safe-install readiness; operator readiness is still unaccepted. Initial branch main3eaf20f remains a source baseline only until exact composition.
