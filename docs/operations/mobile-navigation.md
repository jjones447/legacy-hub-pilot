# Scrolled mobile navigation — O26-01

[pc2-codex-42] October 28, 2026. Source correction; installation and client
acceptance remain separate.

The October 26 client report says the phone menu requires scrolling back up to
see its links. The August 21 normal-flow correction handles a different issue:
the current sticky header remains visible after scrolling, while its sibling
navigation panel is still near the document top. Root41 reproduced this on the
installed production page at 375×667: the open panel was entirely above the
viewport, despite the visible hamburger.

At mobile widths the open panel now uses fixed viewport positioning below the
actual visible header bottom, with a dynamic-viewport height limit and its own
vertical scrolling. It updates on window/visual-viewport resize; returning to
desktop closes the mobile state. Hamburger expanded state is explicit. Escape
retains submenu dismissal first, then closes the main panel and returns focus to
the hamburger. Existing desktop hover/click behavior stays in its shared handler.

The existing navigation tests cover header anchoring, viewport/desktop changes,
layered Escape/focus, bounded scrolling CSS, and the delegated button route.
These are in-memory state/CSS checks, not rendered layout or installation proof.

Root41 owns the affected live check after CT5 installs the reviewed revision:
on a phone viewport, scroll down, open the hamburger and a submenu, reach the
last link using panel scroll, then close/reopen without scrolling to document top.
Check Escape/focus and desktop dropdowns. Preserve the actual installed asset
revision and observations; do not repeat forms, staff, data or provider mutations.

Original intake and the current acceptance entry are in the existing private
Legacy issue54 receipt6447745541 and canonical native plan O26-01. The source PR
and signed issue54 handoff retain exact revision and publication/readback facts.

## Live verification — October 30, 2026

[pc2-codex-42] The existing correction passed the reported deep-scroll journey
on both https://staging.caregiversanctuary.org and https://caregiversanctuary.org
at 05:06 UTC. No further navigation source change was necessary.

The existing PC2 Chromium browser was used with a temporary owned QA tab.
Home, Programs and Sanctuary each passed at 375x667, 320x568 and 667x375:
18 page/environment/viewport combinations, all HTTP 200. After scrolling to the
document bottom, the hamburger opened the fixed menu within the viewport without
scrolling the document back up. A submenu opened, panel scrolling reached the last
Donate link, two Escape presses closed submenu then menu and restored hamburger
focus, and reopening worked at the same document position. Short landscape
viewports kept the expanded menu bounded and independently scrollable.

Additional checks on both environments passed portrait-to-landscape repositioning,
return-to-desktop reset and desktop hover dropdowns. An initial staging desktop
snapshot was taken before the resize event settled; waiting for the actual reset
condition confirmed the correct behavior on both environments. This was a QA
synchronization issue, not evidence of a product defect.

The browser-loaded assets were HTTP 200 and byte-identical to the inspected source:

- `nav-v2.js` SHA-256: `6eaaf9322025c957cc94a033695949c622fec752ea572792dadbd85804915fde`.
- `styles.css` SHA-256: `1a577202a2979af02d7d10918af9663ef2f4de6e43b72209b60a549e176c0218`.

This verifies the installed Chromium viewport journeys, not physical iOS/Safari
or Shanelle's personal device. No remaining defect was reproduced in this scope;
a later device-specific report should provide its browser and reproduction.
No forms, customer data, authentication, deployment or provider settings changed.
Only the owned temporary tabs were closed.

Progressive engineering: reuse the existing correction, source tests and this
runbook; bounded browser tooling supplies the missing installed-behavior evidence.
No new runtime service or navigation implementation is justified by these results.
