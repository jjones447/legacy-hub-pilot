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
