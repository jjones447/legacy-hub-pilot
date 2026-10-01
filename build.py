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

SITE_URL = "https://legacy-hub.pages.dev"
DEFAULT_SHARE_IMAGE = f"{SITE_URL}/media/share-default.jpg"

PAGE_METADATA = {
    "index.html": {
        "title": "Legacy Home & Respite Care Foundation — Caregiver Wellness & Resource Hub",
        "description": "Supporting dementia caregivers through community, wellness, and respite.",
    },
    "about.html": {
        "title": "About Us — Legacy Home & Respite Care Foundation",
        "description": "Legacy exists to be the support we wish our own families had — providing respite care, wellness programs, and community for dementia caregivers.",
    },
    "resources.html": {
        "title": "Resource Hub — Legacy Home & Respite Care Foundation",
        "description": "Everything in one place — crisis lines, education, caregiver tools, local organizations, and practical support for dementia caregivers.",
    },
    "events.html": {
        "title": "Events — Legacy Home & Respite Care Foundation",
        "description": "Upcoming caregiver support groups, wellness workshops, family education, and community events.",
    },
    "programs.html": {
        "title": "The Caregiver Sanctuary — Legacy Home & Respite Care Foundation",
        "description": "A free membership community for caregivers of loved ones with dementia in Greater Milwaukee.",
    },
    "request-support.html": {
        "title": "Request Support — Legacy Home & Respite Care Foundation",
        "description": "For yourself, or for a caregiver you know. One short form, and our care team will connect you to the right support.",
    },
    "gallery.html": {
        "title": "Photo Gallery — Legacy Home & Respite Care Foundation",
        "description": "Photographs from Legacy Home & Respite Care Foundation events, support groups, and caregiver community gatherings.",
    },
    "trusted-resources.html": {
        "title": "Our Trusted Resources — Legacy Home & Respite Care Foundation",
        "description": "Organizations Legacy refers caregivers to for healthcare, respite, legal, and community support.",
    },
    "follow-and-learn.html": {
        "title": "Follow + Learn — Legacy Home & Respite Care Foundation",
        "description": "Dementia and caregiving accounts, educators, and podcasts worth your time.",
    },
    "caregiver-tools.html": {
        "title": "Caregiver Tools & Guides — Legacy Home & Respite Care Foundation",
        "description": "Guides, worksheets, checklists and downloads for dementia caregiving.",
    },
    "community-series.html": {
        "title": "Caregiver Sanctuary Community Series — Legacy Home & Respite Care Foundation",
        "description": "A rotating series of caregiver gatherings across Greater Milwaukee libraries, parks, and partner spaces.",
    },
    "drop-in-respite.html": {
        "title": "Drop-In Respite — Legacy Home & Respite Care Foundation",
        "description": "Drop-in respite for dementia caregivers: trained staff, engaging activities, and a moment to breathe.",
    },
    "coming-soon.html": {
        "title": "Caregiver Sanctuary &mdash; Legacy Home &amp; Respite Care Foundation",
        "description": "A new online home for dementia caregivers in Milwaukee, from Legacy Home &amp; Respite Care Foundation. Coming soon.",
    },
    "blog.html": {
        "title": "Blog & Stories — Legacy Home & Respite Care Foundation",
        "description": "Caregiver stories, reflections and updates from Legacy Home & Respite Care Foundation.",
    },
    "donate.html": {
        "title": "Donate — Legacy Home & Respite Care Foundation",
        "description": "Support respite, wellness and community for dementia caregivers in Greater Milwaukee.",
    },
    "crisis-help.html": {
        "title": "Crisis & Emergency Help — Legacy Home & Respite Care Foundation",
        "description": "Immediate crisis lines and emergency guidance for dementia caregivers in crisis or urgent need.",
    },
    "community-wellness-partners.html": {
        "title": "Community Wellness Partners — Legacy Home & Respite Care Foundation",
        "description": "Local businesses and organizations that work with Legacy to create dementia-friendly spaces and services.",
    },
    "dementia-friendly-training.html": {
        "title": "Dementia-Friendly Training — Legacy Home & Respite Care Foundation",
        "description": "Training and education that helps businesses and organizations become welcoming, supportive spaces for people with dementia.",
    },
    "wellness-passport.html": {
        "title": "Caregiver Wellness Passport — Legacy Home & Respite Care Foundation",
        "description": "A way for caregivers to engage in wellness activities, track restorative moments, and earn community rewards.",
    },
    "faq.html": {
        "title": "Frequently Asked Questions — Legacy Home & Respite Care Foundation",
        "description": "Plain answers to the questions caregivers ask us most often about respite, support groups, and resources.",
    },
    "get-involved.html": {
        "title": "Get Involved — Legacy Home & Respite Care Foundation",
        "description": "Partner, volunteer, sponsor, or invite us to speak to help support dementia caregivers.",
    },
    "portal.html": {
        "title": "Caregiver Portal — Legacy Home & Respite Care Foundation",
        "description": "Your events, your grant and your resources, in one place.",
    },
    "programs-events.html": {
        "title": "Programs & Events — Legacy Home & Respite Care Foundation",
        "description": "Supporting caregivers in every stage of the journey with respite, support groups, and wellness.",
    },
    "sanctuary.html": {
        "title": "Caregiver Sanctuary — Legacy Home & Respite Care Foundation",
        "description": "Building communities where caregivers don't have to navigate dementia alone.",
    },
}

PAGES = {
    "index.html": "index.html.j2",
    "resources.html": "resources.html.j2",
    "events.html": "events.html.j2",
    "about.html": "about.html.j2",
    "programs.html": "programs.html.j2",
    "request-support.html": "request-support.html.j2",
    "gallery.html": "gallery.html.j2",
    "trusted-resources.html": "trusted-resources.html.j2",
    "follow-and-learn.html": "follow-and-learn.html.j2",
    "caregiver-tools.html": "caregiver-tools.html.j2",
    "community-series.html": "community-series.html.j2",
    "drop-in-respite.html": "drop-in-respite.html.j2",
    "coming-soon.html": "coming-soon.html.j2",
    "blog.html": "blog.html.j2",
    "donate.html": "donate.html.j2",
    "crisis-help.html": "crisis-help.html.j2",
    "community-wellness-partners.html": "community-wellness-partners.html.j2",
    "dementia-friendly-training.html": "dementia-friendly-training.html.j2",
    "wellness-passport.html": "wellness-passport.html.j2",
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
    gallery = json.loads((ROOT / "content" / "gallery.json").read_text(encoding="utf-8"))
    links = json.loads((ROOT / "content" / "resource-links.json").read_text(encoding="utf-8"))
    return {"resources": resources["items"], "events": events["items"],
            "sections": sections["items"], "gallery": gallery["items"],
            "trusted_organizations": links["trusted_organizations"],
            "caregiver_recommended": links["caregiver_recommended"],
            "follow_and_learn": links["follow_and_learn"],
            "caregiver_tools": links["caregiver_tools"]}


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


def _splice_head(html: str, head_content: str) -> str:
    """Replace content inside <head>...</head> with head_content."""
    i = html.find("<head>")
    j = html.find("</head>")
    if i == -1 or j == -1:
        return html
    return html[: i + len("<head>")] + "\n" + head_content + "\n" + html[j:]


def _wrap_main_landmark(html: str, page: str) -> str:
    """Ensure the page has <main id="main"> targeting landmark for skip-link."""
    if page == "coming-soon.html":
        if '<main class="cs-main"' in html and 'id="main"' not in html:
            html = html.replace('<main class="cs-main"', '<main class="cs-main" id="main"')
        if 'class="skip-link"' not in html and '<body>' in html:
            html = html.replace('<body>', '<body>\n<a class="skip-link" href="#main">Skip to content</a>')
        return html

    if page == "staff.html":
        return html

    if '<main id="main">' not in html:
        target_after = "<!-- SHARED:header:end -->"
        if target_after in html:
            html = html.replace(target_after, f'{target_after}\n<main id="main">')
        elif '</nav>\n</div>' in html:
            idx = html.find('</nav>\n</div>') + len('</nav>\n</div>')
            html = html[:idx] + '\n<main id="main">' + html[idx:]

        if '<!-- SHARED:footer:start -->' in html:
            html = html.replace('<!-- SHARED:footer:start -->', '</main>\n<!-- SHARED:footer:start -->')
        elif '<footer>' in html:
            html = html.replace('<footer>', '</main>\n<footer>')

    return html


def render_head_for_page(env: Environment, page: str) -> str:
    meta = PAGE_METADATA.get(page, {
        "title": "Legacy Home & Respite Care Foundation",
        "description": "Supporting dementia caregivers through community, wellness, and respite.",
    })
    og_url = f"{SITE_URL}/" if page == "index.html" else f"{SITE_URL}/{page}"
    ctx = {
        "page_title": meta["title"],
        "page_description": meta["description"],
        "og_title": meta.get("og_title", meta["title"]),
        "og_description": meta.get("og_description", meta["description"]),
        "og_image": meta.get("og_image", DEFAULT_SHARE_IMAGE),
        "og_url": og_url,
        "og_type": meta.get("og_type", "website"),
        "og_site_name": meta.get("og_site_name", "Legacy Home & Respite Care Foundation, Inc."),
        "default_share_image": DEFAULT_SHARE_IMAGE,
        "site_url": SITE_URL,
    }
    return env.get_template("_head.html.j2").render(**ctx)


def render_coming_soon_head() -> str:
    return """<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Caregiver Sanctuary &mdash; Legacy Home &amp; Respite Care Foundation</title>
<meta name="description" content="A new online home for dementia caregivers in Milwaukee, from Legacy Home &amp; Respite Care Foundation. Coming soon.">
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="styles.css">
<link rel="icon" href="favicon.ico" sizes="32x32">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="manifest" href="site.webmanifest">"""


def render_shared(env: Environment, ctx: dict) -> dict:
    """Render each hand-authored page with fresh header/footer and shared head spliced in."""
    out = {}
    for page in SHARED_PAGES:
        html = (ROOT / page).read_text(encoding="utf-8")
        for part, tpl in SHARED_PARTS.items():
            body = env.get_template(tpl).render(active_page="", **ctx)
            html = _replace_marked(html, part, body)
        head_content = render_head_for_page(env, page)
        html = _splice_head(html, head_content)
        html = _wrap_main_landmark(html, page)
        out[page] = html
    return out


def render_all() -> dict:
    env = _env()
    ctx = load_content()
    ctx["site_url"] = SITE_URL
    ctx["default_share_image"] = DEFAULT_SHARE_IMAGE

    rendered = {}
    for page, tpl in PAGES.items():
        html = env.get_template(tpl).render(**ctx)
        if page == "coming-soon.html":
            html = _splice_head(html, render_coming_soon_head())
        else:
            head_content = render_head_for_page(env, page)
            html = _splice_head(html, head_content)
        html = _wrap_main_landmark(html, page)
        rendered[page] = html

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
