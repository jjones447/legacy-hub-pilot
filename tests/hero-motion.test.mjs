import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8')
  .split('/* ---------- Live intake forms ---------- */')[0];

function mount({ reduced = false, blocked = false, present = true } = {}) {
  let change;
  const preference = { matches: reduced, addEventListener(type, fn) { change = fn; } };
  const video = {
    controls: true, muted: false, autoplay: false, plays: 0, pauses: 0,
    play() { this.plays++; return blocked ? Promise.reject(new Error('Browser policy')) : Promise.resolve(); },
    pause() { this.pauses++; },
  };
  runInNewContext(source, {
    document: { querySelectorAll: () => present ? [video] : [] },
    window: { matchMedia: () => preference },
  });
  return { video, setReduced(value) { preference.matches = value; change(); } };
}

test('a reduced-motion visitor gets native playback controls without automatic playback', () => {
  const { video } = mount({ reduced: true });
  assert.equal(video.plays, 0);
  assert.equal(video.autoplay, false);
  assert.equal(video.controls, true);
});

test('ordinary playback starts muted and stops when reduced motion is enabled', () => {
  const h = mount();
  assert.equal(h.video.plays, 1);
  assert.equal(h.video.muted, true);
  assert.equal(h.video.autoplay, true);
  h.setReduced(true);
  assert.equal(h.video.pauses, 1);
  assert.equal(h.video.autoplay, false);
});

test('a browser autoplay refusal is handled and leaves manual controls available', async () => {
  const { video } = mount({ blocked: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(video.controls, true);
  assert.equal(video.plays, 1);
});

test('pages without the marked video do not start media or register preference handlers', () => {
  const { video } = mount({ present: false });
  assert.equal(video.plays, 0);
  assert.equal(video.pauses, 0);
});
