// Mounted by the owning portal session. The supplied transport must revalidate
// that session on every read/write and invalidate this panel when it changes.
export function mountRespitePanel(root, transport, { onVisibilityChange }) {
  const document = root.ownerDocument;
  let epoch = 0;

  function reset() {
    epoch++;
    root.replaceChildren();
    onVisibilityChange(false);
  }

  function element(tag, text, parent) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    parent?.append(node);
    return node;
  }

  const dateFormat = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chicago',
  });
  const dateLabel = date => `${date.title} — ${dateFormat.format(new Date(date.starts_at))} Central`;

  function choice(parent, label, options) {
    const select = element('select', '', element('label', label, parent));
    select.required = true;
    for (const [value, text] of [['', 'Choose an answer'], ...options]) {
      const option = element('option', text, select);
      option.value = value;
    }
    return select;
  }

  const yesNo = (parent, label) => choice(parent, label, [['yes', 'Yes'], ['no', 'No']]);

  function render(view) {
    const generation = epoch;
    element('h2', 'Respite Registration', root);
    element('p', 'Fictional test data only. Choose one or more dates to request staff review. A pending request does not reserve a place.', root);
    const receipts = element('ul', '', root);
    receipts.setAttribute('aria-label', 'Your respite requests');
    const datesById = new Map(view.dates.map(date => [date.id, date]));
    const shown = new Set();
    const showReceipt = (receipt, label) => {
      if (shown.has(receipt.id)) return;
      shown.add(receipt.id);
      const statuses = { pending: 'Pending staff review', confirmed: 'Confirmed', declined: 'Declined', withdrawn: 'Withdrawn' };
      element('li', `${label} · ${statuses[receipt.status] ?? 'Status unavailable'}`, receipts);
    };
    for (const receipt of view.requests) {
      const date = datesById.get(receipt.event_id);
      showReceipt(receipt, date ? dateLabel(date) : `Request ${receipt.id}`);
    }

    if (!view.dates.length) {
      element('p', 'No available Drop-In Respite dates right now.', root);
      return;
    }
    if (!view.caregiver) {
      const notice = element('p', 'Add your full name and best contact number in ', root);
      const link = element('a', 'My Profile', notice);
      link.href = 'profile.html';
      notice.append(' before requesting a date.');
      return;
    }

    const { name, email, phone } = view.caregiver;
    const contact = element('dl', '', root);
    for (const [label, value] of [
      ['Caregiver full name', name], ['Caregiver contact email', email], ['Best contact phone', phone],
    ]) {
      element('dt', label, contact);
      element('dd', value, contact);
    }

    const form = element('form', '', root);
    const fields = element('fieldset', '', form);
    element('legend', 'Request details', fields);
    const dates = element('fieldset', '', fields);
    element('legend', 'Requested sessions', dates);
    const dateInputs = view.dates.map(date => {
      const label = element('label', '', element('div', '', dates));
      const checkbox = element('input', '', label);
      checkbox.type = 'checkbox';
      const text = dateLabel(date);
      label.append(text);
      return { date, checkbox, text };
    });

    const selectedParticipant = choice(fields, 'Participant', [
      ...view.participants.map(p => [p.id, p.name]), ['new', 'Add a participant'],
    ]);
    const participantFields = element('fieldset', '', fields);
    participantFields.hidden = true;
    participantFields.disabled = true;
    element('legend', 'New participant', participantFields);
    const questions = view.participant_questions.map(question => {
      const container = element('div', '', participantFields);
      if (question.type === 'boolean') return { question, control: yesNo(container, question.label) };
      const label = element('label', question.label, container);
      const control = element(question.type === 'textarea' ? 'textarea' : 'input', '', label);
      control.maxLength = question.maxLength;
      control.required = question.required;
      return { question, control };
    });
    selectedParticipant.addEventListener('change', () => {
      participantFields.hidden = selectedParticipant.value !== 'new';
      participantFields.disabled = participantFields.hidden;
    });
    const firstTime = yesNo(element('div', '', fields), 'First time attending?');
    const onsite = yesNo(element('div', '', fields), 'Will the caregiver stay on site?');

    const acknowledgments = view.acknowledgments;
    for (const entry of [acknowledgments.privacy, acknowledgments.nonmedical]) {
      const label = element('label', '', element('div', '', fields));
      const box = element('input', '', label);
      box.type = 'checkbox';
      box.required = true;
      label.append(entry.text);
    }

    const status = element('p', '', form);
    status.setAttribute('role', 'status');
    const submit = element('button', 'Request selected dates', form);
    submit.type = 'submit';
    let attempt;
    let sending = false;

    async function send() {
      if (!attempt.participant) {
        const result = await transport.createParticipant(attempt.newParticipant);
        if (generation !== epoch) return;
        if (!result?.ok) return result;
        attempt.participant = { id: result.id, revision: result.revision };
      }
      while (attempt.remaining.length) {
        const { date, text, request_id } = attempt.remaining[0];
        const result = await transport.createPendingRequest({
          ...attempt.answers, request_id, event_id: date.id,
          participant_id: attempt.participant.id, participant_revision: attempt.participant.revision,
        });
        if (generation !== epoch) return;
        if (!result?.ok) return result;
        showReceipt(result, text);
        attempt.remaining.shift();
      }
      return { ok: true };
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (sending || generation !== epoch) return;
      if (!attempt) {
        const selected = dateInputs.filter(item => item.checkbox.checked);
        if (!selected.length || !form.reportValidity()) {
          status.textContent = selected.length ? 'Complete the required answers.' : 'Choose at least one date.';
          return;
        }
        const participant = view.participants.find(p => p.id === selectedParticipant.value);
        attempt = {
          participant, remaining: selected.map(item => ({ ...item, request_id: globalThis.crypto.randomUUID() })),
          answers: {
            first_time: firstTime.value === 'yes', caregiver_onsite: onsite.value === 'yes',
            privacy_ack: true, nonmedical_ack: true,
            acknowledgment_versions: { privacy: acknowledgments.privacy.version, nonmedical: acknowledgments.nonmedical.version },
          },
        };
        if (!participant) {
          attempt.newParticipant = {
            request_id: globalThis.crypto.randomUUID(),
            details: Object.fromEntries(questions.map(({ question, control }) => [
              question.key, question.type === 'boolean' ? control.value === 'yes' : control.value,
            ])),
          };
        }
      }
      sending = true;
      fields.disabled = true;
      submit.disabled = true;
      status.textContent = 'Sending requests for review…';
      let result;
      try { result = await send(); } catch { result = { error: 'outcome_unknown' }; }
      if (generation !== epoch) return;
      sending = false;

      if (result?.ok) {
        status.textContent = 'Your selected dates are pending staff review.';
        return;
      }
      if (result?.error === 'outcome_unknown') {
        status.textContent = 'We could not verify the result. Any receipts shown are saved. Retry to check and send the remaining dates.';
        submit.textContent = 'Retry remaining dates';
        submit.disabled = false;
        return;
      }
      if (result?.error === 'new_acknowledgment_required') {
        status.textContent = 'The acknowledgments changed. Reopen the Respite tab and review the current wording. Any receipts shown are saved.';
        return;
      }
      if (result?.error === 'invalid_details') {
        attempt = undefined;
        fields.disabled = false;
        submit.disabled = false;
        status.textContent = 'Check the participant details, including the emergency phone number and any required personal-care explanation.';
        return;
      }
      status.textContent = 'A request could not be sent. Reopen the Respite tab to check available dates and saved receipts.';
    });
  }

  return {
    reset,
    async load() {
      reset();
      const generation = epoch;
      let view;
      try { view = await transport.read(); } catch { return; }
      if (generation !== epoch || view?.ok !== true || view.visible !== true) return;
      render(view);
      onVisibilityChange(true);
    },
  };
}
