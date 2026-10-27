// In-memory browser-event regression checks. No browser, server or worker startup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../nav-v2.js', import.meta.url), 'utf8');

function harness({ width = 1280, hover = true, fine = true, mediaSupported = true } = {}) {
  let clock = 0;
  let nextTimer = 0;
  const timers = new Map();
  function node(parent = null) {
    const classes = new Set();
    return {
      parent, listeners: {}, attrs: {},
      classList: {
        contains: (name) => classes.has(name),
        toggle(name, value) { if (value) classes.add(name); else classes.delete(name); },
      },
      setAttribute(name, value) { this.attrs[name] = value; },
      addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); },
      contains(other) { for (; other; other = other.parent) if (other === this) return true; return false; },
      focus() { focus(this); },
    };
  }
  const outside = node();
  const items = Array.from({ length: 2 }, () => {
    const item = node();
    item.button = node(item);
    item.label = node(item);
    item.label.href = '/parent-page';
    item.panel = node(item);
    item.link = node(item.panel);
    item.secondLink = node(item.panel);
    item.querySelector = (selector) => selector === '.drop-toggle' ? item.button : null;
    item.button.attrs['aria-expanded'] = 'false';
    return item;
  });
  const document = node();
  document.activeElement = outside;
  document.querySelectorAll = () => items;
  let query;
  const media = {
    matches: width >= 1151 && hover && fine,
    addEventListener(name, fn) { assert.equal(name, 'change'); this.changed = fn; },
  };
  runInNewContext(source, {
    document,
    window: mediaSupported ? { matchMedia(value) { query = value; return media; } } : {},
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, at: clock + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  function dispatch(target, type, data = {}) {
    const event = {
      target, stopped: false, defaultPrevented: false, ...data,
      stopPropagation() { this.stopped = true; },
      preventDefault() { this.defaultPrevented = true; },
    };
    for (const fn of target.listeners[type] ?? []) fn(event);
    if (type === 'click' && target !== document && !event.stopped) {
      for (const fn of document.listeners.click ?? []) fn(event);
    }
    return event;
  }
  let pointerOwner = null;
  function pointerMove(target, pointerType = 'mouse') {
    const next = items.find((item) => item.contains(target)) ?? null;
    if (next === pointerOwner) return;
    if (pointerOwner) dispatch(pointerOwner, 'pointerleave', { pointerType, relatedTarget: target });
    pointerOwner = next;
    if (next) dispatch(next, 'pointerenter', { pointerType, relatedTarget: null });
  }
  function focus(target) {
    const old = document.activeElement;
    document.activeElement = target;
    const owner = items.find((item) => item.contains(old));
    if (owner) dispatch(owner, 'focusout', { target: old, relatedTarget: target });
  }
  function advance(ms) {
    clock += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= clock) { timers.delete(id); timer.fn(); }
    }
  }
  function state(item, open) {
    assert.equal(item.classList.contains('open'), open);
    assert.equal(item.button.attrs['aria-expanded'], String(open));
  }
  return { items, document, outside, dispatch, pointerMove, focus, advance, state, query,
    changeMedia(matches) { media.matches = matches; media.changed?.(); } };
}

test('desktop hover opens from the label, keeps the panel reachable and closes after a short gap', () => {
  const h = harness();
  const [item] = h.items;
  assert.equal(h.query, '(min-width: 1151px) and (hover: hover) and (pointer: fine)');
  h.pointerMove(item.label);
  h.state(item, true);
  h.pointerMove(item.button);
  h.pointerMove(item.link);
  h.advance(500);
  h.state(item, true);
  h.pointerMove(h.outside);
  h.advance(199);
  h.state(item, true);
  h.advance(1);
  h.state(item, false);
});

test('returning across a brief gap cancels closing and switching menus leaves only one open', () => {
  const h = harness();
  const [a, b] = h.items;
  h.pointerMove(a.label);
  h.pointerMove(h.outside);
  h.advance(100);
  h.pointerMove(a.panel);
  h.advance(200);
  h.state(a, true);
  h.pointerMove(b.label);
  h.state(a, false);
  h.state(b, true);
  h.advance(500);
  h.state(b, true);
});

test('Escape closes and restores focus without stationary hover immediately reopening', () => {
  const h = harness();
  const [item] = h.items;
  h.pointerMove(item.link);
  h.focus(item.link);
  h.dispatch(h.document, 'keydown', { key: 'Escape', target: item.link });
  h.state(item, false);
  assert.equal(h.document.activeElement, item.button);
  h.pointerMove(item.button);
  h.advance(500);
  h.state(item, false);
  h.pointerMove(h.outside);
  h.pointerMove(item.label);
  h.state(item, true);
});

test('click toggles still work after hover and outside clicks close every menu', () => {
  const h = harness();
  const [item] = h.items;
  h.pointerMove(item.label);
  h.dispatch(item.button, 'click');
  h.pointerMove(item.button);
  h.advance(500);
  h.state(item, false);
  h.dispatch(item.button, 'click');
  h.state(item, true);
  h.dispatch(h.outside, 'click');
  h.state(item, false);
});

test('keyboard activation and Tab retain focus access when the pointer leaves', () => {
  const h = harness();
  const [item] = h.items;
  h.focus(item.button);
  h.dispatch(item.button, 'click', { detail: 0 });
  h.state(item, true);
  h.pointerMove(item.label);
  h.focus(item.link);
  h.pointerMove(h.outside);
  h.advance(200);
  h.state(item, true);
  const tab = h.dispatch(h.document, 'keydown', { key: 'Tab', target: item.link });
  assert.equal(tab.defaultPrevented, false);
  h.focus(item.secondLink);
  h.advance(200);
  h.state(item, true);
  h.focus(h.outside);
  h.advance(200);
  h.state(item, false);
});

test('focus leaving an already closed menu cannot cancel another menu pending close', () => {
  const h = harness();
  const [a, b] = h.items;
  h.pointerMove(a.label);
  h.focus(a.button);
  h.pointerMove(b.label);
  h.pointerMove(h.outside);
  h.focus(h.outside);
  h.advance(200);
  h.state(a, false);
  h.state(b, false);
});

for (const options of [{ width: 1150 }, { fine: false }, { hover: false }, { width: 375 }]) {
  test(`mobile/coarse/non-hover input retains tap-only dropdowns: ${JSON.stringify(options)}`, () => {
    const h = harness(options);
    const [item] = h.items;
    h.pointerMove(item.label);
    h.state(item, false);
    h.dispatch(item.button, 'click');
    h.state(item, true);
    h.pointerMove(h.outside);
    h.advance(500);
    h.state(item, true);
    h.dispatch(item.button, 'click');
    h.state(item, false);
  });
}

test('touch pointer events do not hover-open on a hybrid device with a fine mouse', () => {
  const h = harness();
  const [item] = h.items;
  h.pointerMove(item.label, 'touch');
  h.state(item, false);
  h.dispatch(item.button, 'click');
  h.pointerMove(h.outside, 'touch');
  h.advance(500);
  h.state(item, true);
});

test('a breakpoint/input change cancels a pending hover close without interfering with taps', () => {
  const h = harness();
  const [item] = h.items;
  h.pointerMove(item.label);
  h.pointerMove(h.outside);
  h.changeMedia(false);
  h.dispatch(item.button, 'click');
  h.dispatch(item.button, 'click');
  h.advance(500);
  h.state(item, true);
});

test('missing matchMedia keeps click controls and parent navigation intact', () => {
  const h = harness({ mediaSupported: false });
  const [item] = h.items;
  h.pointerMove(item.label);
  h.state(item, false);
  h.dispatch(item.button, 'click', { detail: 0 });
  h.state(item, true);
  const event = h.dispatch(item.label, 'click');
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.stopped, false);
  assert.equal(item.label.href, '/parent-page');
  h.state(item, false);
});
