// LEGACY-PORTAL-TAP-TARGETS-R1 — 44px tap-target floor for phone-sized viewports.
//
// Measured on staging at 375x812 (2026-09-29): the nav toggle was 23x34 and the
// .btn-sm controls (portal Sign out, View application, Browse all events, Open
// Resource Hub, card CTAs) were 36 tall. No browser here — this asserts the CSS
// itself carries the floor: min-width/min-height >= 44px on .nav-toggle, and a
// min-height >= 44px rule for .btn-sm under a max-width media query.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.resolve(__dirname, '..', 'styles.css'), 'utf8');

// Bodies of every rule whose selector list includes the class as the last
// compound (covers plain '.btn-sm' and compounds like '.btn-coral.btn-sm'),
// whether top-level or nested inside a media query.
function ruleBodiesFor(className) {
  const bodies = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const hit = m[1].split(',').some((sel) =>
      sel.trim().split(/\s+/).pop().split('.').includes(className)
    );
    if (hit) bodies.push({ selector: m[1].trim(), body: m[2], at: m.index });
  }
  return bodies;
}

function pxValue(body, prop) {
  const m = body.match(new RegExp(`${prop}:\\s*(\\d+(?:\\.\\d+)?)px`));
  return m ? Number(m[1]) : null;
}

test('nav toggle hit area is at least 44x44px (glyph size unchanged)', () => {
  const rules = ruleBodiesFor('nav-toggle');
  assert.ok(rules.length > 0, 'no .nav-toggle rule found in styles.css');
  assert.ok(
    rules.some((r) => pxValue(r.body, 'min-width') >= 44),
    `.nav-toggle needs min-width >= 44px; got ${JSON.stringify(rules.map((r) => r.body))}`
  );
  assert.ok(
    rules.some((r) => pxValue(r.body, 'min-height') >= 44),
    `.nav-toggle needs min-height >= 44px; got ${JSON.stringify(rules.map((r) => r.body))}`
  );
});

// Byte ranges of every '@media (...) { ... }' block, found by brace counting.
function mediaBlockRanges() {
  const ranges = [];
  const re = /@media\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    ranges.push({ query: m[0], start: re.lastIndex, end: i });
  }
  return ranges;
}

test('small buttons get a >= 44px min-height under a max-width media query', () => {
  const rules = ruleBodiesFor('btn-sm');
  assert.ok(rules.length > 0, 'no .btn-sm rule found in styles.css');
  const raised = rules.filter((r) => (pxValue(r.body, 'min-height') ?? 0) >= 44);
  assert.ok(
    raised.length > 0,
    `no .btn-sm rule sets min-height >= 44px; got ${JSON.stringify(rules.map((r) => r.body))}`
  );
  // The floor must live under a phone-width media query, not resize desktop.
  const media = mediaBlockRanges();
  assert.ok(
    raised.some((r) =>
      media.some((b) => r.at >= b.start && r.at < b.end && /max-width:\s*\d+px/.test(b.query))
    ),
    'the 44px .btn-sm rule must sit inside a max-width media query'
  );
});
