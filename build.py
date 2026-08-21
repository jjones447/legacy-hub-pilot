#!/usr/bin/env python3
"""Legacy hub — slice 02 content build (render-to-git).

Renders committed HTML pages from typed content items + fixed templates.
  python build.py            -> regenerate index/resources/events .html in place
  python build.py --verify   -> exit 1 if committed HTML != regenerated (byte equality)

Content model (see legacy-caregiver-hub docs/architecture/content-model.md — private):
content items are data; templates are code; the agent edits items, never templates.
Pages not yet extracted (about/programs/request-support: page_section migration = slice
02.1; portal/staff: app mocks, hand-authored by design).
"""
import json
import sys
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined

ROOT = Path(__file__).parent
PAGES = {
    "index.html": "index.html.j2",
    "resources.html": "resources.html.j2",
    "events.html": "events.html.j2",
    "about.html": "about.html.j2",
    "programs.html": "programs.html.j2",
    "request-support.html": "request-support.html.j2",
}

# Hand-authored pages that are NOT template-rendered but DO share the public chrome.
# Their body stays hand-written; only the header and footer are synced from the shared
# partials, between <!-- SHARED:<part>:start --> / :end markers.
#
# Why this exists: before 2026-08-21 the header lived in seven copies -- the shared
# partial plus six standalone pages. Renaming one nav label meant seven edits, and a
# stale positioning rule in one copy is how the mobile menu regression (#30) hid.
# --verify now covers these pages too, so chrome drift fails the build.
#
# staff.html is deliberately EXCLUDED: the staff console has its own minimal nav by
# design, not the public one.
SHARED_PAGES = [
    "directory.html",
    "faq.html",
    "get-involved.html",
    "portal.html",
    "programs-events.html",
    "sanctuary.html",
]
SHARED_PARTS = {"header": "_header.html.j2", "footer": "_footer.html.j2"}


def load_content() -> dict:
    resources = json.loads((ROOT / "content" / "resources.json").read_text(encoding="utf-8"))
    events = json.loads((ROOT / "content" / "events.json").read_text(encoding="utf-8"))
    sections = json.loads((ROOT / "content" / "page-sections.json").read_text(encoding="utf-8"))
    return {"resources": resources["items"], "events": events["items"], "sections": sections["items"]}


def _env() -> Environment:
    return Environment(
        loader=FileSystemLoader(ROOT / "templates"),
        undefined=StrictUndefined,
        keep_trailing_newline=True,
    )


def _replace_marked(html: str, part: str, body: str) -> str:
    """Swap the content between the SHARED markers, keeping the markers themselves."""
    start, end = f"<!-- SHARED:{part}:start -->", f"<!-- SHARED:{part}:end -->"
    i, j = html.find(start), html.find(end)
    if i == -1 or j == -1:
        raise SystemExit(f"missing {start}/{end} markers")
    return html[: i + len(start)] + "\n" + body + html[j:]


def render_shared(env: Environment, ctx: dict) -> dict:
    """Render each hand-authored page with fresh header/footer spliced in."""
    out = {}
    for page in SHARED_PAGES:
        html = (ROOT / page).read_text(encoding="utf-8")
        for part, tpl in SHARED_PARTS.items():
            body = env.get_template(tpl).render(active_page="", **ctx)
            html = _replace_marked(html, part, body)
        out[page] = html
    return out


def render_all() -> dict:
    env = _env()
    ctx = load_content()
    rendered = {page: env.get_template(tpl).render(**ctx) for page, tpl in PAGES.items()}
    rendered.update(render_shared(env, ctx))
    return rendered


def main() -> int:
    verify = "--verify" in sys.argv
    rendered = render_all()
    drift = []
    for page, html in rendered.items():
        target = ROOT / page
        if verify:
            current = target.read_text(encoding="utf-8") if target.exists() else ""
            if current != html:
                drift.append(page)
        else:
            target.write_text(html, encoding="utf-8", newline="\n")
            print(f"rendered {page}")
    if verify:
        if drift:
            print(f"DRIFT: {', '.join(drift)} — run `python build.py` and commit")
            return 1
        print("verify clean: committed HTML matches rendered content")
    return 0


if __name__ == "__main__":
    sys.exit(main())
