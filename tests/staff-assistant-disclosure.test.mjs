// [pc2-codex-42] Source + synthetic DOM only: no browser, audio or provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = read('staff.html'), js = read('staff.js'), css = read('styles.css');
const disclosure = js.slice(js.indexOf('// Presentation only:'), js.indexOf('// Extend the browser chat controls'));

function harness() {
  const doc = { activeElement: null };
  const node = id => ({
    id, hidden: id === 'staffAssistantPanel', textContent: '', attrs: {}, listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    setAttribute(name, value) { this.attrs[name] = value; },
    focus() { doc.activeElement = this; },
  });
  const nodes = Object.fromEntries(['staffAssistantToggle', 'staffAssistantPanel', 'staffAssistantClose', 'chatInput', 'micBtn', 'outside'].map(id => [id, node(id)]));
  nodes.staffAssistantPanel.contains = active => [nodes.chatInput, nodes.micBtn, nodes.staffAssistantClose].includes(active);
  doc.getElementById = id => nodes[id] ?? null;
  doc.activeElement = nodes.outside;
  nodes.chatInput.value = 'Unsaved request';
  const statuses = [];
  const context = vm.createContext({ document: doc, setMicStatus: text => statuses.push(text),
    isRecording: false, draft: { id: 'fictional-draft', preview: 'exact-version' },
    agentConfirmationHold: true, agentConfirmationPending: true,
    fetch() { throw new Error('Disclosure must not call an API'); },
    window: { sessionStorage: { setItem() { throw new Error('No persistent open state'); } } },
  });
  vm.runInContext(disclosure, context);
  context.initStaffAssistantDisclosure();
  return { context, nodes, doc, statuses,
    click: id => nodes[id].listeners.click(),
    key(event) { nodes.staffAssistantPanel.listeners.keydown(event); },
  };
}

test('assistant is collapsed by default near top, before full-width workspace with unique preserved controls', () => {
  assert.match(html, /id="staffAssistantToggle"[^>]*aria-expanded="false"[^>]*aria-controls="staffAssistantPanel"/);
  assert.match(html, /<section id="staffAssistantPanel"[^>]*aria-labelledby="staffAssistantHeading"[^>]* hidden>/);
  assert.ok(html.indexOf('id="staffAssistantToggle"') < html.indexOf('id="staffAssistantPanel"'));
  assert.ok(html.indexOf('id="staffAssistantPanel"') < html.indexOf('class="staff-workspace"'));
  assert.ok(html.indexOf('class="staff-workspace"') < html.indexOf('id="caregiverSearchPanel"'));
  assert.doesNotMatch(html, /split-align-start-12-1|class="split /);
  for (const id of ['chatAreaSelect', 'chatBody', 'chatEmptyState', 'chatInput', 'micBtn', 'micStatus']) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `${id} preserved once`);
  }
  assert.match(html, /id="micBtn"[^>]*data-action="agent-mic"[^>]*aria-label="Record voice note"/);
  assert.match(html, /id="chatInput"[^>]*aria-label="Message to Legacy Assistant"[^>]*aria-describedby="staffAssistantHelp"/);
});

test('load never steals focus; open, close and Escape synchronize aria and restore focus', () => {
  const h = harness();
  assert.equal(h.nodes.staffAssistantPanel.hidden, true);
  assert.equal(h.nodes.staffAssistantToggle.attrs['aria-expanded'], 'false');
  assert.equal(h.doc.activeElement, h.nodes.outside);
  h.click('staffAssistantToggle');
  assert.equal(h.nodes.staffAssistantPanel.hidden, false);
  assert.equal(h.nodes.staffAssistantToggle.attrs['aria-expanded'], 'true');
  assert.equal(h.doc.activeElement, h.nodes.chatInput);
  h.click('staffAssistantClose');
  assert.equal(h.nodes.staffAssistantPanel.hidden, true);
  assert.equal(h.doc.activeElement, h.nodes.staffAssistantToggle);
  h.click('staffAssistantToggle');
  let prevented = false;
  h.key({ key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(h.nodes.staffAssistantPanel.hidden, true);
  assert.equal(h.doc.activeElement, h.nodes.staffAssistantToggle);
});

test('ordinary keys, composing Escape and already-handled keys do not close or steal focus', () => {
  const h = harness();
  h.click('staffAssistantToggle');
  for (const event of [{ key: 'Enter' }, { key: 'Escape', isComposing: true }, { key: 'Escape', defaultPrevented: true }]) {
    h.key({ ...event, preventDefault() { throw new Error('Do not override another control'); } });
    assert.equal(h.nodes.staffAssistantPanel.hidden, false);
  }
});

test('hide/reopen retains input, draft and confirmation HOLD/pending; never submits or auto-confirms', () => {
  const h = harness();
  const draft = h.context.draft;
  h.click('staffAssistantToggle');
  h.click('staffAssistantClose');
  h.click('staffAssistantToggle');
  assert.equal(h.nodes.chatInput.value, 'Unsaved request');
  assert.equal(h.context.draft, draft);
  assert.equal(h.context.agentConfirmationHold, true);
  assert.equal(h.context.agentConfirmationPending, true);
  assert.doesNotMatch(disclosure, /fetch\(|agentSend\(|confirm|discard|innerHTML|removeChild|sessionStorage/);
});

test('recording stays visible; close asks for microphone stop rather than hiding or sending audio', () => {
  const h = harness();
  h.click('staffAssistantToggle');
  h.context.isRecording = true;
  h.click('staffAssistantClose');
  assert.equal(h.nodes.staffAssistantPanel.hidden, false);
  assert.equal(h.nodes.staffAssistantToggle.attrs['aria-expanded'], 'true');
  assert.equal(h.doc.activeElement, h.nodes.micBtn);
  assert.match(h.statuses[0], /Stop recording/);
  h.context.isRecording = false;
  h.click('staffAssistantClose');
  assert.equal(h.nodes.staffAssistantPanel.hidden, true);
  // A delayed permission response opens the panel without unexpectedly moving focus.
  h.context.setStaffAssistantExpanded(true, false);
  assert.equal(h.nodes.staffAssistantPanel.hidden, false);
  assert.equal(h.doc.activeElement, h.nodes.staffAssistantToggle);
  assert.match(js, /setStaffAssistantExpanded\(true, false\);\s*mediaRecorder\.start\(\)/);
});

test('phone layout wraps compose, target controls, long previews and preserves touch/focus targets', () => {
  assert.match(css, /\.staff-assistant-panel\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.staff-workspace, \.staff-workspace > div\s*\{[^}]*width:\s*100%/);
  assert.match(css, /\.staff-assistant-panel \.chat-area-bar\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.staff-assistant-panel \.chat-area-select\s*\{[^}]*max-width:\s*100%[^}]*min-height:\s*44px/);
  const mobile = css.slice(css.indexOf('@media (max-width: 600px) {\n  .staff-assistant-panel'));
  assert.match(mobile, /\.chat-input-row\s*\{\s*flex-wrap:\s*wrap/);
  assert.match(mobile, /input\s*\{[^}]*flex-basis:\s*100%/);
  assert.match(mobile, /button\s*\{[^}]*min-height:\s*44px/);
  assert.match(mobile, /\.confirm-row\s*\{\s*flex-wrap:\s*wrap/);
  assert.match(mobile, /\.preview\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.staff-assistant-toggle:focus-visible[^}]*outline:\s*3px/);
});

test('plain selector/help distinguishes browser preview path from separate Slack and handoff path', () => {
  assert.match(js, /label\.textContent = 'Existing content to change:'/);
  assert.match(js, /Choose existing content to edit…/);
  assert.match(html, /browser chat to preview an edit before you confirm it/);
  assert.match(html, /Slack is a separate entry point; this panel does not show the Slack conversation/);
  assert.doesNotMatch(html, /can't break the site/);
  assert.match(js, /document\.getElementById\('chatContentTarget'\)/);
  assert.match(js, /function initAssistantHandoff\(/);
  assert.match(js, /panel\.setAttribute\('aria-label', 'Assistant request handoff'\)/);
  assert.match(js, /document\.getElementById\('assistantHandoffRegion'\) \|\| document\.getElementById\('chatBody'\)/);
  assert.ok(html.indexOf('id="assistantHandoffRegion"') < html.indexOf('<section id="staffAssistantPanel"'));
  assert.doesNotMatch(disclosure, /assistantHandoffRegion|handoff=|location\.hash/);
  assert.match(read('build.py'), /portal\/staff: app mocks, hand-authored by design/);
});
