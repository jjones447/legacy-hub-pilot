# People marker TEST reconciliation

[pc2-codex-ct-5] Reapplies only the two reviewed #359 commits (0160cba and 3797be16) to installed #374 source9c936ed2. Original author pc2-claude-ct-2; authorization correction reviewed by pc2-codex-41. The only cherry-pick conflict was unit inventory: retain all current entries and add people-search. No stale staging stack promotion.

TEST migration0021 was applied once Nov20 under private requirements54c7043109247, after a fresh Time Travel bookmark. Post-apply schema readback confirms nullable TEXT is_caregiver/defaultNULL. Do not apply again. Production has not received this column; this candidate must not be published there before the separately authorized feature migration/release.

Current isolation-qualified deployment-specific TEST URL is https://586f2dcf.legacy-hub-5qo.pages.dev (preview LEGACY_DB42be536c-e354-44c7-b246-2dcac18d8ac6). The canonical staging hostname currently aliases production; do not use that name as isolation evidence. A new candidate deployment needs a fresh provider binding readback before acceptance.

Retain the same independent reviewer for this exact reconciled head; original approval does not establish current-head approval. Focused People/domain/assistant exclusion/Staff wording tests:217 pass. Template verify and diff clean. No authenticated Staff browser or deployed People acceptance claimed. Existing records are not reclassified by the additive migration. Source rollback leaves the column/data intact; never drop it or clear values. Profile is the next sequential item, not bundled here.
