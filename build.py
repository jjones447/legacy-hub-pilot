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
}


def load_content() -> dict:
    resources = json.loads((ROOT / "content" / "resources.json").read_text(encoding="utf-8"))
    events = json.loads((ROOT / "content" / "events.json").read_text(encoding="utf-8"))
    return {"resources": resources["items"], "events": events["items"]}


def render_all() -> dict:
    env = Environment(
        loader=FileSystemLoader(ROOT / "templates"),
        undefined=StrictUndefined,
        keep_trailing_newline=True,
    )
    ctx = load_content()
    return {page: env.get_template(tpl).render(**ctx) for page, tpl in PAGES.items()}


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
