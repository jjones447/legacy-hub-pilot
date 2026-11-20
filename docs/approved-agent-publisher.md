# Approved content publisher: design and operations

[pc2-codex-ct-5] Nov20 source design for private requirements54c7050609159.
Supersedes the prior recommendation to wait for a human Staff browser. This
candidate is not installed and creates no token, policy, credential or data.
Profile Nov22 delivery retains priority. Same Devin4 source review and ct12
security read precede TEST installation.

## Capability and approval contract

The existing middleware still verifies Access RS256/issuer/audience/expiry.
Only a service JWT without email whose common_name equals the configured
LEGACY_PUBLISHER_CLIENT_ID receives a new request-local publisher symbol.
Pin the actual verified service claim after provisioning; a display name or a
body actor is insufficient. This maps to audit actor service:legacy-publisher.
The symbol never grants confirmationActor: human assistant confirmation and
workflow confirmation remain unchanged. The in-product assistant has no publisher
tool or credential and cannot construct this symbol.

Named publisher requests are fenced to POST /api/agent/publisher/draft,
/preview and /confirm. Other service identities, human sessions and dev headers
cannot use these operations. No workflow/direct-edit/discard/assistant transport
is granted. In preview only, GET /staff variants and GET /api/staff/caregivers
are allowed for People search acceptance. No People writes, exports, production
Staff reads or admin role is granted. Existing unrelated service behavior is not
broadened. Machine calls use the token headers each time; supplied Origin must
match. JSON is streamed with a16KiB cap; unknown actor/conversation fields refuse.

A reference string alone is not evidence of customer consent. The reviewed
server-owned publisher-approvals.mjs catalog binds each recorded approval to
one target/type and EXACT changed values. The initial catalog records approved
Home journey paragraph under tracker:6966964897 (#371) and tracker:7043252292
(final #375 look carrying that wording). No arbitrary model proposal is accepted.
New approved operands enter through normal source/review, never an HTTP request
or assistant-generated registry edit. The publisher preserves all unrelated
current fields, refusing missing/nonpublished/type-mismatched targets. No schema
change, new content item or caregiver record is authorized by this route.

The draft stores actor+approval reference+target in existing updated_by metadata.
Preview returns before/after and the existing full draft/target/origin digest.
Confirmation requires the same capability, persisted owner/ref, catalog-matching
proposal, exact preview version and unchanged target. Original conditional
publish audit goes FIRST in the same batch as target update/draft archival.
Prior values remain in before_json; after_json includes approval_ref. Drift or
audit failure aborts. A lost acknowledgment is UNKNOWN: read/reconcile audit and
status before retry; a repeated confirm cannot generate a second publish audit.
This synthetic SQLite contract still needs native D1 qualification.

## Provisioning and TEST qualification

Use the existing approved ops identity; never print secrets or request a human
Staff sign-in. Read inventory and preserve existing app/policy/domains before
changing them. On Nov20 this seat's configured Legacy account returned200 with
EMPTY apps and service_tokens lists. Pages CF_ACCESS_TEAM_DOMAIN/CF_ACCESS_AUD
are present as secret_text in BOTH production and preview; their values were not
retrieved or printed. Existing Access app account/id must be located before updating it:
do not create a duplicate application or guess an audience.

Create one named legacy-publisher Access service token via the established
Service Tokens API after review. Save the one-time client_secret directly to the
existing Vault secret location and publisher-seat private file, mode0600, without
terminal output; verify Vault write/readback through the established secret
custodian. This seat currently has no exposed Vault writer/CLI, so secret custody
handoff must be qualified before token creation to avoid losing its one-time value.
Only the publisher process receives the credential; never site JavaScript,
repo, PR, chat, test fixture or in-product assistant.

Add a Service Auth policy for that token ONLY to the existing Staff application;
retain existing human policies. Qualify actual legacy-hub-5qo deployment-specific
preview host/path coverage in addition to the historical legacy-hub.pages.dev
entries. Preserve unrelated apps/account settings; do not turn on dev mode.
Configure the verified token common_name pin in both selected environments.
A client-id-like claim may differ from its display label: confirm the claim under
the real JWT verifier, not by trusting caller headers. Obtain a fresh provider
readback and rejection probes with no token/wrong token.

TEST must bind42be536c-e354-44c7-b246-2dcac18d8ac6. Canonical staging currently
aliases production, so use a qualified deployment-specific URL. Deploy the
exact independently reviewed candidate. Test with a separately reviewed synthetic
content approval operand/target, never silently overwrite existing TEST content
just to test. No synthetic operand is enabled by this initial production catalog.
Verify valid flow plus wrong ref/copy/target, cross-origin, stale version, audit
failure, other-token and assistant refusals. Confirm TEST People search read via
the permitted routes; edits are intentionally unavailable. A200 static asset is
not Staff feature acceptance. No production publication until these checks and
the reviewed release qualification pass.

## Publish approved371 and375

Before/after packet uses the registered Home journey paragraph only; support tile
titles/secondary/unrelated content are not overwritten. Existing371 template/
rewriter handles the two-paragraph value. Reconcile375 layout while preserving
that binding; its old static paragraph removal is not the release candidate.
Obtain exact integrated source review/current checks. Snapshot current governed
content/draft/version and prior source deployment for rollback. Draft with
approval_ref tracker:7043252292, target_id ps_home.journey and exact catalog
changes; preview; confirm SAME draft/reference/version. Read original audit and
public rendered Home/Our Model/About/support copy. Do not claim source fallback
equals published content or publish375 alone to evade the editor.

Rollback of approved public content is a NEW reviewed operation bound to a
recorded approval, preserving the prior audit. This route has no unapproved
rollback escape. Code rollback must account for the new publisher-owned draft
metadata; older human routes must never adopt those drafts.

## Rotate and revoke

Cloudflare Service Tokens documentation:
https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/
API reference:
https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/service_tokens/

Use the existing named token's supported rotate endpoint with the approved ops
identity; store returned credential directly in Vault/private seat, validate,
then retire prior secret per provider semantics. Retain name/id and policy scope;
do not issue a second broadly privileged token. Revoke by removing/denying its
Service Auth policy or disabling/deleting that token through the supported API;
also remove the application client-id pin to fail closed on cached assertions.
Verify denial on production AND preview. Existing requests/committed publishes
cannot be undone by revocation; retained content audit/rollback is separate.
Never claim immediate invalidation of every in-flight request or cached JWT.

## Evidence and pending deployment gates

Initial focused tests exercise real signed JWT verification, separate capabilities,
approval operands, owner/origin/version, preserved fields, concurrent drift,
audit failure and replay refusal. No live token/access policy/Vault write, native
D1 publish, rendered preview, production change or People browser acceptance
follows from source tests. No Cloudflare owner-only dashboard step has yet been
proved: exact current engineering gaps are locating the existing app/account and
qualifying Vault storage using the established ops/secret custodians. Escalate
only a demonstrated API permission/ownership refusal, not a generic human login.
