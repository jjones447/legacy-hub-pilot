import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountRespitePanel } from '../../portal-respite-ui.mjs';
import { readOwnerRespiteView, readStaffPendingRespiteRequests } from '../../functions/_lib/respite-views.mjs';
import { createRespiteParticipant } from '../../functions/_lib/respite-participant-store.mjs';
import { createPendingRespiteRequest } from '../../functions/_lib/respite-pending-store.mjs';
import { readRespiteAcknowledgments } from '../../functions/_lib/respite-acknowledgments.mjs';
import { participantDetails, respiteFixture } from '../helpers/respite-fixture.mjs';

function panel(db, overrides = {}) {
  const dom = new JSDOM('<section></section>');
  const root = dom.window.document.querySelector('section');
  const visibility = [];
  const transport = {
    read: () => readOwnerRespiteView(db, 'owner'),
    createParticipant: body => createRespiteParticipant(db, 'owner', body),
    createPendingRequest: body => createPendingRespiteRequest(db, 'owner', body),
    ...overrides,
  };
  const view = mountRespitePanel(root, transport, { onVisibilityChange: visible => visibility.push(visible) });
  return { root, view, visibility };
}

async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'panel did not reach the expected state');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function complete(root, { createParticipant = false } = {}) {
  const form = root.querySelector('form');
  const selects = [...form.querySelectorAll('select')];
  const participant = selects.shift();
  participant.value = createParticipant ? 'new' : 'p';
  participant.dispatchEvent(new root.ownerDocument.defaultView.Event('change'));
  const [firstTime, onsite] = selects.slice(-2);
  firstTime.value = 'no';
  onsite.value = 'yes';
  for (const checkbox of form.querySelectorAll('input[type="checkbox"]')) checkbox.checked = true;
  return form;
}

test('mount renders pinned wording and sends each selected date with its own key', async () => {
  const { db, raw } = respiteFixture({ seedParticipant: false });
  try {
    const requests = [];
    const { view, root, visibility } = panel(db, {
      async createPendingRequest(body) {
        requests.push(body);
        return createPendingRespiteRequest(db, 'owner', body);
      },
    });
    await view.load();
    assert.deepEqual(visibility, [false, true]);
    const policy = readRespiteAcknowledgments();
    assert.ok(root.textContent.includes(policy.privacy.text));
    assert.ok(root.textContent.includes(policy.nonmedical.text));
    const form = complete(root, { createParticipant: true });
    const participantFields = form.querySelectorAll('fieldset')[2];
    const fields = (await readOwnerRespiteView(db, 'owner')).participant_questions;
    [...participantFields.querySelectorAll('input,textarea,select')].forEach((control, index) => {
      const question = fields[index];
      const value = participantDetails[question.key];
      control.value = question.type === 'boolean' ? (value ? 'yes' : 'no') : value;
    });
    form.requestSubmit();
    await until(() => root.querySelector('[role="status"]').textContent.includes('pending staff review'));
    assert.equal(requests.length, 2);
    assert.notEqual(requests[0].request_id, requests[1].request_id);
    assert.equal(requests[0].participant_id, requests[1].participant_id);
    assert.deepEqual(requests[0].acknowledgment_versions, {
      privacy: policy.privacy.version, nonmedical: policy.nonmedical.version,
    });
    assert.equal(root.querySelectorAll('li').length, 2);
    assert.equal((await readStaffPendingRespiteRequests(db, 'staff@example.invalid')).requests.length, 2);
    assert.equal(raw.prepare('SELECT count(*) AS n FROM registration').get().n, 0);
  } finally {
    raw.close();
  }
});

test('after a lost response, retry uses the original date key and leaves the saved date alone', async () => {
  const { db, raw } = respiteFixture();
  try {
    const calls = [];
    const { view, root } = panel(db, {
      async createPendingRequest(body) {
        calls.push(body);
        const result = await createPendingRespiteRequest(db, 'owner', body);
        if (calls.length === 2) throw Error('fictional transport loss');
        return result;
      },
    });
    await view.load();
    const form = complete(root);
    form.requestSubmit();
    await until(() => root.querySelector('button').textContent === 'Retry remaining dates');
    assert.equal(root.querySelectorAll('li').length, 1);
    form.requestSubmit();
    await until(() => root.querySelectorAll('li').length === 2);
    assert.deepEqual(calls[1], calls[2]);
    assert.equal(raw.prepare('SELECT count(*) AS n FROM respite_request').get().n, 2);
  } finally {
    raw.close();
  }
});

test('reset ignores late results, clears private view, and stops subsequent dates', async () => {
  const { db, raw } = respiteFixture();
  try {
    let release;
    let calls = 0;
    const { view, root, visibility } = panel(db, {
      async createPendingRequest() {
        calls++;
        return new Promise(resolve => { release = resolve; });
      },
    });
    await view.load();
    complete(root).requestSubmit();
    assert.equal(calls, 1);
    view.reset();
    release({ ok: true, id: 'fictional-old-session', status: 'pending' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(root.textContent, '');
    assert.equal(visibility.at(-1), false);
    raw.exec("UPDATE caregiver_profile SET fields_json='{}'");
    await view.load();
    assert.equal(root.textContent, '');
    assert.equal(visibility.at(-1), false);
  } finally {
    raw.close();
  }
});

test('a stale rendered acknowledgment stops the attempt and requires fresh agreement', async () => {
  const { db, raw } = respiteFixture();
  try {
    const { view, root } = panel(db, {
      async read() {
        const current = await readOwnerRespiteView(db, 'owner');
        return {
          ...current,
          acknowledgments: {
            ...current.acknowledgments,
            privacy: { text: 'Earlier fictional wording', version: 'retired_version' },
          },
        };
      },
    });
    await view.load();
    assert.match(root.textContent, /Earlier fictional wording/);
    complete(root).requestSubmit();
    await until(() => root.querySelector('[role="status"]').textContent.includes('The acknowledgments changed'));
    assert.equal(root.querySelector('button').disabled, true);
    assert.equal(raw.prepare('SELECT count(*) n FROM respite_request').get().n, 0);
  } finally {
    raw.close();
  }
});
