// LP04 source-only version/answer domain. No persistence, enrollment, endpoint,
// profile/task update, score, diagnosis or collection authorization is implied.
// Extends the journey design separately from legacy wellness.js's mutable fixed
// questions: historical wording/options/types must travel with future responses.
export const QUESTIONNAIRE_LIMITS = Object.freeze({ questions: 50, options: 20, text: 1000 });

function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key))) {
    throw new TypeError('Invalid questionnaire data');
  }
}

function string(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new TypeError('Invalid questionnaire text');
  }
  return value;
}

function identifier(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(value) ||
      ['constructor', 'prototype', '__proto__'].includes(value)) {
    throw new TypeError('Invalid questionnaire identifier');
  }
  return value;
}

function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError('Invalid questionnaire number');
  }
  return value;
}

function optionsSnapshot(options) {
  if (!Array.isArray(options) || options.length < 2 || options.length > QUESTIONNAIRE_LIMITS.options) {
    throw new TypeError('Invalid questionnaire options');
  }
  const ids = new Set();
  return Object.freeze(Array.from(options, option => {
    object(option, ['id', 'label']);
    const id = identifier(option.id);
    if (ids.has(id)) throw new TypeError('Duplicate option identifier');
    ids.add(id);
    return Object.freeze({ id, label: string(option.label, 200) });
  }));
}

function questionSnapshot(question) {
  const fields = ['id', 'label', 'type', 'required'];
  const kinds = {
    numeric: ['min', 'max'], single_choice: ['options'], multi_choice: ['options'],
    conditional_choice: ['options', 'textWhen', 'textMax'],
  };
  if (!question || !Object.hasOwn(kinds, question.type)) throw new TypeError('Unsupported question type');
  object(question, [...fields, ...kinds[question.type]]);
  if (typeof question.required !== 'boolean') throw new TypeError('Requiredness must be explicit');
  const snapshot = {
    id: identifier(question.id), label: string(question.label, 500),
    type: question.type, required: question.required,
  };
  if (snapshot.type === 'numeric') {
    snapshot.min = integer(question.min, -1000, 1000);
    snapshot.max = integer(question.max, -1000, 1000);
    if (snapshot.min >= snapshot.max) throw new TypeError('Invalid numeric scale');
  } else {
    snapshot.options = optionsSnapshot(question.options);
    if (snapshot.type === 'conditional_choice') {
      snapshot.textWhen = identifier(question.textWhen);
      if (!snapshot.options.some(option => option.id === snapshot.textWhen)) {
        throw new TypeError('Conditional text must name an option');
      }
      snapshot.textMax = integer(question.textMax, 1, QUESTIONNAIRE_LIMITS.text);
    }
  }
  return Object.freeze(snapshot);
}

export function questionnaireSnapshot(value) {
  object(value, ['id', 'version', 'title', 'questions']);
  const id = identifier(value.id);
  const version = integer(value.version, 1, 1000000);
  if (!Array.isArray(value.questions) || !value.questions.length ||
      value.questions.length > QUESTIONNAIRE_LIMITS.questions) throw new TypeError('Invalid question count');
  const ids = new Set();
  const questions = Array.from(value.questions, question => {
    const snapshot = questionSnapshot(question);
    if (ids.has(snapshot.id)) throw new TypeError('Duplicate question identifier');
    ids.add(snapshot.id);
    return snapshot;
  });
  return Object.freeze({ id, version, title: string(value.title, 200), questions: Object.freeze(questions) });
}

// Storage integration must enforce unique (id, version) and append-only versions.
// This pure producer cannot guarantee cross-request publication concurrency.
export function reviseQuestionnaire(previous, draft) {
  const old = questionnaireSnapshot(previous);
  object(draft, ['title', 'questions']);
  return questionnaireSnapshot({
    id: old.id, version: old.version + 1, title: draft.title, questions: draft.questions,
  });
}

function answerSnapshot(question, value) {
  if (question.type === 'numeric') return integer(value, question.min, question.max);
  const option = id => {
    if (typeof id !== 'string' || !question.options.some(item => item.id === id)) {
      throw new TypeError('Invalid answer');
    }
    return id;
  };
  if (question.type === 'single_choice') return option(value);
  if (question.type === 'multi_choice') {
    if (!Array.isArray(value) || !value.length || value.length > question.options.length ||
        new Set(value).size !== value.length) throw new TypeError('Invalid answer');
    return Object.freeze(Array.from(value, option));
  }
  object(value, ['choice', 'text']);
  const choice = option(value.choice);
  const answer = { choice };
  if (Object.hasOwn(value, 'text')) {
    if (choice !== question.textWhen || typeof value.text !== 'string' ||
        value.text.length > question.textMax) throw new TypeError('Invalid answer');
    answer.text = value.text;
  }
  return Object.freeze(answer);
}

export function questionnaireAnswers(snapshot, input) {
  const questionnaire = questionnaireSnapshot(snapshot);
  object(input, questionnaire.questions.map(question => question.id));
  const answers = {};
  for (const question of questionnaire.questions) {
    if (!Object.hasOwn(input, question.id)) {
      if (question.required) throw new TypeError('Missing required answer');
      continue;
    }
    // Null/undefined/empty values are invalid supplied answers, not implicit skips.
    answers[question.id] = answerSnapshot(question, input[question.id]);
  }
  return Object.freeze({ questionnaire, answers: Object.freeze(answers) });
}

// Conservative default: never combine across questionnaire versions, even when
// labels/scales happen to match. No composite score or clinical interpretation.
export function numericSeriesKey(snapshot, questionId) {
  const questionnaire = questionnaireSnapshot(snapshot);
  const question = questionnaire.questions.find(item => item.id === questionId);
  if (!question || question.type !== 'numeric') throw new TypeError('Numeric question required');
  return `${questionnaire.id}:v${questionnaire.version}:${question.id}`;
}
