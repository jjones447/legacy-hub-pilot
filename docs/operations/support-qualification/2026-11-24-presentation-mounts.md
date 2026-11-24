# Support presentation and browser packaging successor

Ct5 patch from exact387b09caec053b19eafd102899123a5ca4b9f04bfd0, for ct13 composition.
No server dispatcher/auth/session implementation, schema application, deployment,
capture, email or real collection changes.

## Delivered

- Explicit five-file browser .mjs allowlist. It does not widen the general root
  pattern, serve Functions/schema or make unrelated .mjs files public. A dist test
  resolves every static relative import from the actual copied browser modules.
- Hidden owner mount roots in portal and Request Support; hidden Staff root in
  existing Staff page. Template-owned Request Support is updated at its template,
  rendered output verified. Existing public form is wrapped in
  supportLegacyPublicForm, for explicit feature-aware composition rather than
  showing two simultaneous writers. Profile links/fields and Staff controls remain.
- Module entry exposes window.LegacySupportMounts after loading, emits
  legacy-support-mounts-ready, and disposes on pagehide. No network/auth/login is
  initiated by loading the module. mountOwner/resetOwner/mountStaff/resetStaff/
  dispose are explicit callbacks for ct13's session composition. Hidden root alone
  is not proof the feature is integrated or authorized.
- Staff UI consumes the fixed list/status endpoints. It renders request content
  through textContent, uses server revision in status writes, and freezes an
  uncertain/conflicting update until explicit refresh. No auto-retry or fabricated
  success, status mapping or external notification. Reset removes private rows and
  invalidates pending results.
- Owner history401 now clears fields/history and shows sign-in-needed instead of
  retaining an old owner's form state. Existing controller/session callbacks still
  require the actual auth adapter wiring.

## Required ct13 composition

Mount only after verified owner/current human Staff and the enabled support
capability. Wire reset immediately on owner change/revocation/logout, dispose on
unmount, requalify on BFCache restoration. Hide portalSupportCard or
supportLegacyPublicForm as appropriate only when the new feature is available;
do not silently allow the legacy email/upsert writer beside owner-bound creation.
Server Staff list/status projection and exact QA/archived-owner exclusions remain
ct13 source. Reconcile generic linked-followup actions so legacy done/dismissed
cannot silently impersonate the explicit new request status lifecycle.

This patch intentionally does not modify app.js, server handlers, cookies,
identity parsing or capture. Ct13 owns those and final composed build regeneration.
Local generated outputs are supplied for byte-equality verification; final version
stamps and import serving need review on the exact selected composition.

## Evidence

Local full unit2385 PASS. Four actual JSDOM form/Staff/mount tests PASS: explicit
mount/no automatic requests, pending result invalidation/reset, literal rendering
of markup-like message, server revision/uncertain outcome, multi-select/Text and
confirmed receipt. Unit packaging tests2 PASS; build verify clean; actual dist121
files with closed imports. JSDOM is not a physical browser/mobile/layout, native
D1, installed Staff session or customer acceptance proof. Stacked PR CI may not
run under main-only workflow filters; exact composed hosted checks and retained
review are still required. Support remains disabled and candidate schema unapplied.

## Serialized registration callback amendment

The entry also exports mount(root, transport) for ct13's standalone session module.
It makes no request before the caller's /me validation. Each owner mount calls
window.registerPortalSupportView(view) exactly once when that callback is present;
it retains the returned unregister function and calls it once on dispose/remount.
reset clears data but retains the registered view for the same session. Registration
failures dispose the view and propagate, rather than claiming a safe mounted state.
Ct13 reserves all app.js owner-change/logout/session wiring and Staff server routes.
The existing convenience mountOwner calls history only after the session caller
explicitly invokes it. No automatic auth fetch or cookie parser was introduced.

## Staff projection amendment

The dedicated Staff module now exports readStaffSupportRequests(db, verifiedEmail).
It returns {ok:true,requests} with the agreed fixed ten-field projection (status
is {code,label} or null), or {ok:false,error:'forbidden'}. It authorizes current
active Staff/admin before querying, repeats that predicate inside the sensitive
SELECT and checks again before returning rows. Archived owners and the existing
internal-QA source/tag policy are excluded; ordinary inactive/nonarchived owners
remain eligible. The query is capped at50 with stable created_at/id ordering and
returns no contact identity, request key or digest. Seven local SQLite Staff tests
cover CAS plus bounded projection, source/tag exclusions and revocation before/
after projection. Shared HTTP dispatcher remains ct13-owned; no helper proves
verified identity merely because an email argument was supplied. No runtime or
native D1 qualification is implied.

## Session module / BFCache amendment

The explicit allowlist now includes the sixth browser module, ct13's unchanged
portal-support-session.mjs copied from the387 successor (dependency only, no
ct5 session edits). bindOwnerPageLifecycle(view,root,revalidate) accepts ct13's
validated session.start callback. pagehide resets/hides without disposing,
while pageshow/focus hide history until revalidation succeeds; actual unmount
disposes/unregisters. No automatic module-load fetch. Convenience mountOwner
requires an explicitly supplied session-wrapped fetch (or one supplied to the
factory); it does not default to raw global fetch. Standalone session bootstrap
still belongs to ct13 and must call start before the initial mount.
