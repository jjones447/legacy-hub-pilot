# Event photo attachments

Staff create a draft event, choose **Edit**, select a photo and choose **Upload photo**.
The separate photo form previews the saved attachment, supports replacement/removal,
and accepts an optional short description. Event details and publishing retain their
existing controls. Photos appear on the public event card only for published events.

## Storage and access

- Apply additive `schema/0018_event_photos.sql` before installing this source. It adds
  nullable `event.photo_key`/`photo_alt` and an audit idempotency index, with no new table,
  bucket, credential, service, provider or gallery-sync change.
- `POST /api/staff/event-photo/:id` accepts multipart `photo`, `alt`, `request_id`
  and `expected_photo_key`. To remove, send `remove=1` without a file. Every mutation
  requires the exact same Origin plus verified, currently active Access staff identity;
  service tokens or a client-supplied actor do not substitute for that identity.
- JPEG, PNG and still WebP signatures and raster dimensions are checked, including
  PNG chunk boundaries and WebP frame/canvas agreement. Maximum file size is 5 MiB,
  maximum side 10,000 pixels and maximum area 40 megapixels. The multipart stream is
  bounded before parsing. SVG, MIME mismatch, incomplete headers and invalid dimensions
  are refused. This is bounded structural validation, not a complete image-codec decode.
- Candidate bytes use opaque `event-photos/<uuid>.<extension>` in existing `MEDIA`.
  Metadata identifies the event, type, dimensions and SHA-256. Original filenames and
  file contents are not logged. Generic event/Assistant updates cannot set storage keys.
- Association and ORIGINAL `event.photo.updated` audit commit in one D1 batch, with
  expected-photo, current staff-status and nonarchived-event conditions. Identical request
  replay returns the original audit; a conflicting reuse or stale editor is refused.
  Current staff event readback and the existing change log include the photo association
  and original audit. The change log offers no unsupported photo undo.
- `GET /api/staff/event-photo/:id` previews only the current event attachment to active
  staff. Public `/media/r2/<key>` independently requires the current published event
  reference and matching object metadata/type. These responses use `no-store` and
  `nosniff`. Draft, unpublished, archived, replaced and removed images are not public.
  Existing downloads cannot be recalled; future network requests are publication-gated.
- Prior objects remain private for recovery/history. Only an unused candidate belonging
  to the current failed request may be deleted after authoritative primary readback.
  Lost write replies resolve against the original audit. An unresolvable outcome retains
  the candidate and locks the UI until page reload/readback; it never silently retries.

## Release and QA

Use the normal unit allowlist (`scripts/run-tests.mjs unit`), including the isolated
SQLite/R2 and staff/public DOM fixtures. These test upload persistence, auth/revocation,
limits, original audit, duplicates/concurrency, atomic rollback, uncertain readback,
public visibility/removal, retained old objects and safe card rendering. Unit proof is
not live installation or client acceptance; the separately held native harness is not
part of this feature's unit execution.

Install migration and matching code in the existing staging target first, preserving
the separate production database and current Pages Functions, bindings, gallery media,
mail/Access/secrets and concurrent releases. Verify actual schema and installed source.
Any disposable live fixture must first be qualified as staging-only with no client
notifications, production linkage or existing-client-record changes. Do not mutate a
real event or publish a synthetic production event to manufacture acceptance. Remove
only the authorized fixture attachment/event according to its agreed cleanup scope.

After qualified staging and review, compose with current main, retain the prior release
artifact and publish through the established authenticated Pages Direct Upload path.
Keep the additive schema on code rollback; never drop columns or remove historical
photo/audit objects as a rollback shortcut. Record exact source/artifact, staging,
production and user-visible proof separately in the existing private project ledger.

Authored by [pc2-codex-42].
