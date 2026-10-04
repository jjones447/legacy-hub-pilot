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

test('question arrays reject iterators that hide indexed questions', () => {
  const draft = make();
  let calls = 0;
  draft.questions[Symbol.iterator] = function* () { calls++; };
  assert.throws(() => questionnaireSnapshot(draft), TypeError);
  assert.equal(calls, 0);
});

test('question arrays reject iterators that exceed the checked count', () => {
  const draft = make();
  draft.questions = [draft.questions[0]];
  let calls = 0;
  draft.questions[Symbol.iterator] = function* () {
    calls++;
    for (let i = 0; i < 51; i++) yield { ...draft.questions[0], id: `q${i}` };
  };
  assert.throws(() => questionnaireSnapshot(draft), TypeError);
  assert.equal(calls, 0);
});

for (const count of [0, 21]) {
  test(`option arrays reject iterators yielding ${count} different items`, () => {
    const draft = make();
    const options = draft.questions[1].options;
    let calls = 0;
    options[Symbol.iterator] = function* () {
      calls++;
      for (let i = 0; i < count; i++) yield { id: `o${i}`, label: `Option ${i}` };
    };
    assert.throws(() => questionnaireSnapshot(draft), TypeError);
    assert.equal(calls, 0);
  });
}

test('selection arrays reject iterators changing between uniqueness and copying', () => {
  const selection = ['a', 'b'];
  let calls = 0;
  selection[Symbol.iterator] = function* () {
    yield 'a';
    yield ++calls === 1 ? 'b' : 'a';
  };
  assert.throws(() => questionnaireAnswers(make(), { selection }), TypeError);
  assert.equal(calls, 0);
});

test('input arrays reject subclasses, changed prototypes and extra own fields', () => {
  class Questions extends Array {}
  for (const change of [
    draft => { draft.questions = Questions.from(draft.questions); },
    draft => { Object.setPrototypeOf(draft.questions, Object.create(Array.prototype)); },
    draft => { draft.questions.extra = true; },
    draft => { draft.questions[1].options.extra = true; },
  ]) {
    const draft = make();
    change(draft);
    assert.throws(() => questionnaireSnapshot(draft), TypeError);
  }
  const selection = ['a'];
  selection.extra = true;
  assert.throws(() => questionnaireAnswers(make(), { selection }), TypeError);
});

test('array index accessors are rejected without invocation', () => {
  const draft = make();
  const question = draft.questions[0];
  let calls = 0;
  Object.defineProperty(draft.questions, '0', { get() { calls++; return question; } });
  assert.throws(() => questionnaireSnapshot(draft), TypeError);
  assert.equal(calls, 0);
  const options = make();
  const option = options.questions[1].options[0];
  Object.defineProperty(options.questions[1].options, '0', { get() { calls++; return option; } });
  assert.throws(() => questionnaireSnapshot(options), TypeError);
  const selection = ['a'];
  Object.defineProperty(selection, '0', { get() { calls++; return 'a'; } });
  assert.throws(() => questionnaireAnswers(make(), { selection }), TypeError);
  assert.equal(calls, 0);
});

test('record accessors cannot change questionnaire or answer fields while copying', () => {
  const draft = make();
  let calls = 0;
  Object.defineProperty(draft, 'title', { get() { calls++; return 'Changed'; } });
  assert.throws(() => questionnaireSnapshot(draft), TypeError);
  assert.equal(calls, 0);
  const input = {};
  Object.defineProperty(input, 'rating', { get() { calls++; return 1; } });
  assert.throws(() => questionnaireAnswers(make(), input), TypeError);
  assert.equal(calls, 0);
  for (const field of ['type', 'required', 'min']) {
    const nested = make();
    const value = nested.questions[0][field];
    Object.defineProperty(nested.questions[0], field, { get() { calls++; return value; } });
    assert.throws(() => questionnaireSnapshot(nested), TypeError);
  }
  const options = make();
  Object.defineProperty(options.questions[1].options[0], 'id', { get() { calls++; return 'a'; } });
  assert.throws(() => questionnaireSnapshot(options), TypeError);
  assert.equal(calls, 0);
});

test('array symbol fields are rejected even with ordinary iteration', () => {
  const draft = make();
  draft.questions[Symbol('extra')] = true;
  assert.throws(() => questionnaireSnapshot(draft), TypeError);
  const selection = ['a'];
  selection[Symbol('extra')] = true;
  assert.throws(() => questionnaireAnswers(make(), { selection }), TypeError);
});

test('canonical null-prototype records still preserve frozen detached snapshots', () => {
  const draft = make();
  const plain = value => Object.assign(Object.create(null), value);
  draft.questions = draft.questions.map(question => plain(question.options ? {
    ...question, options: question.options.map(plain),
  } : question));
  const source = plain(draft);
  const input = plain({ rating: 2, selection: ['b', 'a'], detail: plain({ choice: 'yes', text: '' }) });
  const response = questionnaireAnswers(source, input);
  assert.deepEqual(response.answers, { rating: 2, selection: ['b', 'a'], detail: { choice: 'yes', text: '' } });
  assert.equal(response.questionnaire.questions.length, 4);
  assert.ok(Object.isFrozen(response.answers.selection));
  input.selection[0] = 'a';
  assert.deepEqual(response.answers.selection, ['b', 'a']);
});

for (const kind of ['single_choice', 'multi_choice', 'conditional_choice']) {
  for (const nested of [false, true]) {
    for (const admission of ['snapshot', 'answers', 'revision']) {
      test(`${admission} rejects ${nested ? 'nested ' : ''}JSON-array question type ${kind}`, () => {
        const draft = JSON.parse(JSON.stringify(make()));
        const question = draft.questions.find(item => item.type === kind);
        question.type = nested ? [[kind]] : [kind];
        if (admission === 'snapshot') {
          assert.throws(() => questionnaireSnapshot(draft), TypeError);
        } else if (admission === 'answers') {
          assert.throws(() => questionnaireAnswers(draft, {}), TypeError);
        } else {
          assert.throws(() => reviseQuestionnaire(draft, {
            title: 'Next', questions: make().questions,
          }), TypeError);
        }
      });
    }
  }
}

for (const [kind, id, answer] of [
  ['numeric', 'rating', 2], ['single_choice', 'choice', 'a'],
  ['multi_choice', 'selection', ['b', 'a']],
  ['conditional_choice', 'detail', { choice: 'yes', text: 'example' }],
]) {
  test(`primitive ${kind} preserves dispatch and detached version history`, () => {
    const draft = make();
    const response = questionnaireAnswers(draft, { [id]: answer });
    const next = reviseQuestionnaire(draft, { title: 'Next', questions: make().questions });
    draft.questions.find(item => item.id === id).type = 'changed';
    assert.equal(response.questionnaire.questions.find(item => item.id === id).type, kind);
    assert.deepEqual(response.answers[id], answer);
    assert.equal(next.version, 2);
    assert.equal(next.questions.find(item => item.id === id).type, kind);
    assert.ok(Object.isFrozen(response.questionnaire.questions.find(item => item.id === id)));
  });
}

test('boxed question type is not a supported primitive string', () => {
  const draft = make();
  draft.questions[1].type = new String('single_choice');
  assert.throws(() => questionnaireSnapshot(draft), TypeError);
});

test('question kind lookup never coerces a nonstring type', () => {
  const draft = make();
  let calls = 0;
  draft.questions[1].type = { toString() { calls++; return 'single_choice'; } };
  assert.throws(() => questionnaireSnapshot(draft), TypeError);
  assert.equal(calls, 0);
});
