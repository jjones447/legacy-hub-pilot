import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  questionnaireSnapshot, reviseQuestionnaire, questionnaireAnswers, numericSeriesKey,
} from '../functions/_lib/wellness-questionnaires.js';

// Generic synthetic examples; no client instrument or caregiver information.
const make = () => ({ id: 'sample', version: 1, title: 'Example form', questions: [
  { id: 'rating', label: 'Example rating', type: 'numeric', required: false, min: 1, max: 10 },
  { id: 'choice', label: 'Example choice', type: 'single_choice', required: false,
    options: [{ id: 'a', label: 'First' }, { id: 'b', label: 'Second' }] },
  { id: 'selection', label: 'Example selections', type: 'multi_choice', required: false,
    options: [{ id: 'a', label: 'First' }, { id: 'b', label: 'Second' }] },
  { id: 'detail', label: 'Example optional detail', type: 'conditional_choice', required: false,
    options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], textWhen: 'yes', textMax: 10 },
] });

test('snapshot preserves exact wording, order, options, types and requiredness', () => {
  assert.deepEqual(questionnaireSnapshot(make()), make());
});

test('snapshot is detached and deeply immutable, including options', () => {
  const draft = make();
  const snapshot = questionnaireSnapshot(draft);
  draft.title = 'Changed';
  draft.questions[1].options[0].label = 'Changed';
  draft.questions.push(draft.questions[0]);
  assert.equal(snapshot.title, 'Example form');
  assert.equal(snapshot.questions[1].options[0].label, 'First');
  assert.equal(snapshot.questions.length, 4);
  assert.throws(() => { snapshot.questions[0].label = 'Changed'; });
  assert.throws(() => { snapshot.questions[1].options.push({ id: 'c', label: 'Third' }); });
});

test('revision advances version without changing earlier form or response', () => {
  const original = make();
  const response = questionnaireAnswers(original, { rating: 7, choice: 'a' });
  const edited = make();
  edited.questions[0].max = 5;
  edited.questions[0].label = 'New rating';
  edited.questions[1].options[0].label = 'Reworded';
  const next = reviseQuestionnaire(original, { title: 'New form', questions: edited.questions });
  assert.equal(next.version, 2);
  assert.equal(next.id, original.id);
  assert.equal(response.questionnaire.questions[0].max, 10);
  assert.equal(response.questionnaire.questions[0].label, 'Example rating');
  assert.equal(response.questionnaire.questions[1].options[0].label, 'First');
  assert.deepEqual(response.answers, { rating: 7, choice: 'a' });
  assert.throws(() => questionnaireAnswers(next, { rating: 7 }));
});

test('all supported answers preserve types and do not write profile/task state', () => {
  const input = { rating: 10, choice: 'b', selection: ['b', 'a'], detail: { choice: 'yes', text: ' example ' } };
  const original = structuredClone(input);
  const response = questionnaireAnswers(make(), input);
  assert.deepEqual(response.answers, original);
  input.selection[0] = 'a';
  input.detail.text = 'changed';
  assert.deepEqual(response.answers, original);
  assert.throws(() => { response.answers.selection[0] = 'a'; });
  assert.throws(() => { response.answers.detail.text = 'change'; });
  assert.deepEqual(Object.keys(response), ['questionnaire', 'answers']);
});

test('optional answers may be omitted; requiredness is explicit', () => {
  assert.deepEqual(questionnaireAnswers(make(), {}).answers, {});
  const form = make();
  form.questions[0].required = true;
  assert.throws(() => questionnaireAnswers(form, {}));
  assert.equal(questionnaireAnswers(form, { rating: 1 }).answers.rating, 1);
  delete form.questions[0].required;
  assert.throws(() => questionnaireSnapshot(form));
});

for (const value of ['1', true, null, undefined, NaN, Infinity, 1.5, 0, 11, {}]) {
  test(`numeric answer rejects ${String(value)}`, () => {
    assert.throws(() => questionnaireAnswers(make(), { rating: value }));
  });
}

test('choice validation rejects labels, coercion, unknown, repeated and empty choices', () => {
  for (const value of ['First', 'c', null, true, ['a']]) {
    assert.throws(() => questionnaireAnswers(make(), { choice: value }));
  }
  for (const value of [[], ['a', 'a'], ['c'], 'a', null, ['a', 'b', 'a']]) {
    assert.throws(() => questionnaireAnswers(make(), { selection: value }));
  }
});

test('optional conditional text is bounded, typed and allowed only for its choice', () => {
  assert.deepEqual(questionnaireAnswers(make(), { detail: { choice: 'yes' } }).answers.detail, { choice: 'yes' });
  assert.deepEqual(questionnaireAnswers(make(), { detail: { choice: 'no' } }).answers.detail, { choice: 'no' });
  for (const value of [{ choice: 'no', text: '' }, { choice: 'yes', text: 'x'.repeat(11) },
    { choice: 'yes', text: 1 }, { choice: 'yes', extra: true }, null, 'yes']) {
    assert.throws(() => questionnaireAnswers(make(), { detail: value }));
  }
});

test('unknown answer fields and inherited answers cannot satisfy required questions', () => {
  assert.throws(() => questionnaireAnswers(make(), { other: 1 }));
  assert.throws(() => questionnaireAnswers(make(), JSON.parse('{"__proto__":1}')));
  assert.throws(() => questionnaireAnswers(make(), Object.create({ rating: 2 })));
  const form = make();
  form.questions[0].required = true;
  assert.throws(() => questionnaireAnswers(form, Object.create(null)));
  const answers = Object.create(null);
  answers.rating = 2;
  assert.equal(questionnaireAnswers(form, answers).answers.rating, 2);
});

test('malformed questionnaire roots, versions and limits fail closed', () => {
  for (const value of [null, [], 'form', { ...make(), version: 0 }, { ...make(), version: '1' },
    { ...make(), version: 1.5 }, { ...make(), version: 1000001 }, { ...make(), questions: [] },
    { ...make(), id: 'constructor' }, { ...make(), title: '' }, { ...make(), extra: true },
    { ...make(), questions: Array.from({ length: 51 }, (_, i) => ({ ...make().questions[0], id: `q${i}` })) }]) {
    assert.throws(() => questionnaireSnapshot(value));
  }
});

test('question and option identities are unique, bounded and prototype-safe', () => {
  const form = make();
  form.questions.push(form.questions[0]);
  assert.throws(() => questionnaireSnapshot(form));
  for (const change of [
    question => { question.id = 'constructor'; }, question => { question.label = 'x'.repeat(501); },
    question => { question.type = 'text'; }, question => { question.required = 1; },
    question => { question.min = 10; }, question => { question.min = '1'; },
    question => { question.max = Infinity; }, question => { question.options = []; },
  ]) {
    const draft = make(); change(draft.questions[0]); assert.throws(() => questionnaireSnapshot(draft));
  }
  for (const options of [[], [{ id: 'a', label: 'A' }],
    [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }],
    [{ id: 'a', label: 'A' }, { id: 'prototype', label: 'B' }],
    [{ id: 'a', label: 'A' }, { id: 'b', label: '' }]]) {
    const draft = make(); draft.questions[1].options = options;
    assert.throws(() => questionnaireSnapshot(draft));
  }
});

test('conditional definition rejects missing choice and excessive text limit', () => {
  for (const patch of [{ textWhen: 'missing' }, { textMax: 0 }, { textMax: 1001 }, { textMax: '10' }]) {
    const draft = make(); Object.assign(draft.questions[3], patch);
    assert.throws(() => questionnaireSnapshot(draft));
  }
});

test('revision cannot replace identity/version or overflow version bounds', () => {
  for (const patch of [{ id: 'other' }, { version: 1 }, { unknown: true }]) {
    assert.throws(() => reviseQuestionnaire(make(), { title: 'Next', questions: make().questions, ...patch }));
  }
  assert.throws(() => reviseQuestionnaire({ ...make(), version: 1000000 }, { title: 'Next', questions: make().questions }));
});

test('graphs are per numeric question/version, never an implicit mixed score', () => {
  const form = make();
  const next = reviseQuestionnaire(form, { title: form.title, questions: form.questions });
  assert.equal(numericSeriesKey(form, 'rating'), 'sample:v1:rating');
  assert.equal(numericSeriesKey(next, 'rating'), 'sample:v2:rating');
  for (const id of ['choice', 'selection', 'detail', 'missing']) assert.throws(() => numericSeriesKey(form, id));
});

test('response snapshot survives JSON round-trip with version and original options', () => {
  const response = questionnaireAnswers(make(), { choice: 'a', detail: { choice: 'yes', text: 'example' } });
  const restored = JSON.parse(JSON.stringify(response));
  assert.deepEqual(questionnaireAnswers(restored.questionnaire, restored.answers), response);
});

test('sparse arrays cannot smuggle missing questions, options or selections', () => {
  const missingQuestion = make();
  delete missingQuestion.questions[0];
  assert.throws(() => questionnaireSnapshot(missingQuestion));
  const missingOption = make();
  delete missingOption.questions[1].options[0];
  assert.throws(() => questionnaireSnapshot(missingOption));
  const selection = ['a', 'b'];
  delete selection[0];
  assert.throws(() => questionnaireAnswers(make(), { selection }));
});

test('symbol and nonplain payloads fail closed without copying unknown fields', () => {
  const symbolic = make();
  symbolic[Symbol('extra')] = true;
  assert.throws(() => questionnaireSnapshot(symbolic));
  assert.throws(() => questionnaireAnswers(make(), new Date()));
  const inheritedQuestion = make();
  inheritedQuestion.questions[0] = Object.create(inheritedQuestion.questions[0]);
  assert.throws(() => questionnaireSnapshot(inheritedQuestion));
});
