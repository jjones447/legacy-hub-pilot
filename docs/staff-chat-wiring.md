# Staff chat source correction

[pc2-codex-13] October 4, 2026. This is a Phase 1 D7 frontend correction candidate, not installed or client acceptance evidence.

The previous Content branch returned a canned preview without calling an API or obtaining a draft ID. Event requests sent a null target even when an event was selected. The shell had no Forms choice. Existing API tests did not execute these browser functions.

## Using the corrected candidate

The existing shell gains a Forms choice and a labeled published-item selector when JavaScript initializes. Content and Forms list only published items loaded from `/api/staff/content`. Forms is limited to existing `page_section` items whose IDs start with `ps_form.`; it edits form copy and existing options, not submission schemas or participant data. Content excludes those forms. Select a target explicitly; no target is guessed and no new content item is created by this correction.

Content and Forms request `/api/agent/draft`, show the returned full draft and retain its `draft_id` for `/api/agent/confirm` or `/api/agent/discard`. Before is explicitly labeled as last-loaded published copy, not a server-verified concurrency snapshot. A refusal, failed response or missing durable ID offers no confirmation. The existing APIs continue to enforce validation, authentication and audit behavior; this frontend change adds none of those guarantees.

Caregiver and Grant retain their selected-record workflow. Event now supplies the selected event ID and renders an Event preview. With no selection it asks staff to select an event; new-event creation remains in the existing New Event form. These three areas retain `/api/agent/change/*` and `change_id`. Both discard routes require successful HTTP and JSON results before claiming success.

`staff.html`, generated templates, CSS, backend functions, schema, credentials and provider settings are unchanged. Dynamic controls avoid the HTML/CSS paths retained by the original PR161 author. The source correction does not take over the existing runtime operator's custody.

## Verification and remaining acceptance

`node --test tests/staff-chat-wiring-d7.test.mjs` executes the actual browser functions with a synthetic DOM and mocked fetch. The original main source fails 15 of 19 tests; the correction passes all 19. The seven-file selected D7 suite passes 88 tests on local Node26.2, with no failures or skips. This is not Node24 parity, actual browser layout, signed login, Cloudflare D1/workerd or provider acceptance.

The existing operator must verify the exact installed source and bindings, readable controls at desktop/mobile widths, available published items and mapper, and a representative draft → preview → confirm → publish → audit operation in each of the five areas using an approved isolated synthetic fixture. Include discard/refusal cases, current authentication, before/after target correlation and the recorded audit actor. Content concurrency/rollback semantics and installed backend behavior still require their own evidence; the cached Before label does not prove drift protection. Do not run customer-data writes, send client messages, activate reminders or bypass the held runtime-preparation command for this check.

Independent exact-head source review, integration, hosted CI evidence and installed runtime acceptance must be recorded separately. Until those steps and staff/client acceptance are evidenced, D7 and Phase 1 remain open.
