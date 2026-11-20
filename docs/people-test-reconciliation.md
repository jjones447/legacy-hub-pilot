# People marker TEST reconciliation

[pc2-codex-ct-5] Reapplies only the two reviewed #359 commits (0160cba and 3797be16) to installed #374 source9c936ed2. Original author pc2-claude-ct-2; authorization correction reviewed by pc2-codex-41. The only cherry-pick conflict was unit inventory: retain all current entries and add people-search. No stale staging stack promotion.

TEST migration0021 was applied once Nov20 under private requirements54c7043109247, after a fresh Time Travel bookmark. Post-apply schema readback confirms nullable TEXT is_caregiver/defaultNULL. Do not apply again. Production has not received this column; this candidate must not be published there before the separately authorized feature migration/release.

Current isolation-qualified deployment-specific TEST URL is https://586f2dcf.legacy-hub-5qo.pages.dev (preview LEGACY_DB42be536c-e354-44c7-b246-2dcac18d8ac6). The canonical staging hostname currently aliases production; do not use that name as isolation evidence. A new candidate deployment needs a fresh provider binding readback before acceptance.

Retain the same independent reviewer for this exact reconciled head; original approval does not establish current-head approval. Focused People/domain/assistant exclusion/Staff wording tests:217 pass. Template verify and diff clean. No authenticated Staff browser or deployed People acceptance claimed. Existing records are not reclassified by the additive migration. Source rollback leaves the column/data intact; never drop it or clear values. Profile is the next sequential item, not bundled here.

## Delegated support-group test completion correction

Hosted unit run44780292950 failed the success-display assertion after a single setImmediate. The owning forms-live test was byte-identical at base9c936ed2 and candidate04a759ee (git blob5ce0886b9d6ced53a3a2dff9955b1e9d7b17ffaa); app.js is also unchanged by this candidate. A controlled 20ms response delay reproduced the same premature none-versus-block assertion on BOTH exact source trees. This proves the test's one-turn completion assumption is invalid; it does not reconstruct the exact hosted scheduling delay or excuse the failure as flaky.

The correction holds the fetch acknowledgment explicitly, asserts pending/hidden success/hidden route/no navigation while held, then releases it and awaits the actual terminal UI state (success OR error) with a bounded test timeout. The existing success, exact payload, navigation, shared task, audit, retry deduplication, no-membership/no-registration/no-grant assertions remain. The retry independently awaits terminal state too. Error completion still fails the existing success assertion. Production form code is unchanged; this is synchronization of the actual delegated handler test, not a sleep or an assertion relaxation.
