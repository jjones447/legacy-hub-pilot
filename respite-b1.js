/* Fictional B1 qualification UI. No storage, AI, generic intake or external messaging. pc1-codex-5. */
(() => {
  'use strict';
  const fieldLabels = {
    caregiver_name: ['Caregiver full name', 120, true],
    contact_email: ['Caregiver contact email', 254, true], contact_phone: ['Best contact phone', 40, true],
    participant_name: ['Loved one full name', 120, true], age: ['Age (optional)', 3, false],
    relationship: ['Relationship to loved one', 80, true],
    mobility: ['Mobility and support needs (write none if none)', 600, true],
    communication: ['Communication preferences and support', 600, true],
    personal_care_detail: ['Personal-care help explanation (required if yes)', 600, false],
    safety: ['Safety considerations (optional)', 600, false],
    allergies_diet: ['Allergies / dietary needs (write none if none)', 600, true],
    activities: ['Enjoyable activities', 600, true], comfort: ['Comfort and support preferences (optional)', 600, false],
    emergency_name: ['Emergency contact full name', 120, true],
    emergency_relationship: ['Emergency contact relationship', 80, true], emergency_phone: ['Emergency contact phone', 40, true],
  };
  const booleanLabels = {
    first_time: 'First time attending?', personal_care_help: 'Personal-care assistance needed?',
    medication_help: 'Medication assistance needed? Staff must discuss accommodation.', caregiver_onsite: 'Will the caregiver stay on site?',
  };
  const make = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
  async function json(url, init) {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init });
    const body = await res.json();
    if (!res.ok || !body.ok) throw new Error('Request not confirmed. Refresh the review or retry the same request without changing answers.');
    return body;
  }
  async function initializeForm() {
    const form = document.getElementById('respiteForm');
    if (!form) return;
    const message = document.getElementById('respiteMessage');
    const fields = document.getElementById('respiteFields');
    try {
      const config = await json('/api/respite');
      if (!config.draft || !config.sessions?.length || !config.acknowledgments?.privacy || !config.acknowledgments?.nonmedical) return;
      const select = form.elements.namedItem('event_id');
      select.appendChild(make('option', 'Choose an explicitly published session')).value = '';
      for (const session of config.sessions) select.appendChild(make('option', session.title + ' — ' + session.starts_at)).value = session.id;
      const questions = document.getElementById('respiteQuestions');
      for (const [name, [label, maxLength, required]] of Object.entries(fieldLabels)) {
        const wrap = make('label', label), input = make(maxLength > 254 ? 'textarea' : 'input');
        input.name = name; input.maxLength = maxLength; input.required = required;
        if (name === 'contact_email') input.type = 'email';
        if (name.includes('phone')) input.type = 'tel';
        wrap.appendChild(input); questions.appendChild(wrap);
      }
      for (const [name, label] of Object.entries(booleanLabels)) {
        const wrap = make('label', label), input = make('select'); input.name = name; input.required = true;
        for (const [value, text] of [['','Choose yes or no'],['true','Yes'],['false','No']]) input.appendChild(make('option', text)).value = value;
        wrap.appendChild(input); questions.appendChild(wrap);
      }
      document.getElementById('respitePrivacy').textContent = config.acknowledgments.privacy;
      document.getElementById('respiteNonmedical').textContent = config.acknowledgments.nonmedical;
      // Never infer acceptance, pre-check, or persist answers/idempotency keys in storage.
      form.elements.namedItem('privacy_ack').checked = false;
      form.elements.namedItem('nonmedical_ack').checked = false;
      const requestId = crypto.randomUUID();
      let busy = false, done = false;
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy || done || !form.reportValidity()) return;
        const body = { request_id: requestId, event_id: select.value, ack_version: config.ack_version };
        for (const name of Object.keys(fieldLabels)) body[name] = form.elements.namedItem(name).value;
        for (const name of Object.keys(booleanLabels)) body[name] = form.elements.namedItem(name).value === 'true';
        body.privacy_ack = form.elements.namedItem('privacy_ack').checked === true;
        body.nonmedical_ack = form.elements.namedItem('nonmedical_ack').checked === true;
        busy = true; fields.disabled = true;
        try {
          const result = await json('/api/respite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          message.textContent = result.message; done = true; form.reset(); form.hidden = true;
        } catch (error) { message.textContent = error.message; fields.disabled = false; }
        finally { busy = false; }
      });
      fields.disabled = false; form.hidden = false;
      message.textContent = 'Fictional qualification only. Submit for staff review, not confirmation.';
    } catch { message.textContent = 'Collection is not available. Do not enter personal details.'; }
  }
  let generation = 0;
  async function loadPending(eventId) {
    const stamp = ++generation;
    const panel = document.getElementById('attendancePanel');
    document.getElementById('respiteReview')?.remove();
    if (!panel) return;
    let data;
    try { data = await json('/api/staff/respite?event_id=' + encodeURIComponent(eventId)); }
    catch { return; } // Default OFF / unlisted reviewers: no private UI or detail fetch.
    if (stamp !== generation) return;
    const section = make('section'); section.id = 'respiteReview';
    section.appendChild(make('h3', 'Respite pending review — fictional draft'));
    section.appendChild(make('p', 'First-time participants require follow-up. Details are restricted to designated reviewers. No automatic messages are sent.'));
    panel.appendChild(section);
    for (const application of data.applications || []) {
      const card = make('div'); section.appendChild(card);
      card.appendChild(make('p', application.id + ' — ' + application.status +
        (application.first_time && !application.followup_at ? ' — first-time follow-up needed' : '')));
      const open = make('button', 'Review private details'); open.type = 'button'; card.appendChild(open);
      open.addEventListener('click', async () => {
        open.disabled = true;
        try {
          const detail = await json('/api/staff/respite?id=' + encodeURIComponent(application.id));
          if (stamp !== generation) return;
          const content = make('div'); card.appendChild(content);
          const close = make('button', 'Close private details'); close.type = 'button'; content.appendChild(close);
          close.addEventListener('click', () => { content.remove(); open.disabled = false; });
          for (const [name, value] of Object.entries(detail.details)) content.appendChild(make('p', (fieldLabels[name]?.[0] || booleanLabels[name] || name) + ': ' + String(value)));
          content.appendChild(make('p', 'Acknowledgments received: ' + detail.application.acknowledged_at + ' / ' + detail.application.privacy_version + ' / ' + detail.application.nonmedical_version));
          if (detail.application.status !== 'pending') return;
          const identityLabel = make('label', 'Existing caregiver record ID — verify identity independently, never email-match automatically');
          const idInput = make('input'); identityLabel.appendChild(idInput); content.appendChild(identityLabel);
          const verifiedLabel = make('label', 'I independently verified this is the correct caregiver record');
          const verified = make('input'); verified.type = 'checkbox'; verified.checked = false; verifiedLabel.appendChild(verified); content.appendChild(verifiedLabel);
          const message = make('p'); message.setAttribute('role','status'); content.appendChild(message);
          for (const [action, label] of [['resolve_identity','Save verified identity'],['complete_followup','Record first-time follow-up completed'],['confirm','Confirm place after review'],['decline','Decline request']]) {
            const button = make('button', label); button.type = 'button'; content.appendChild(button);
            button.addEventListener('click', async () => {
              if (!window.confirm('Record this staff decision? This does not send a message.')) return;
              const body = { id: detail.application.id, revision: detail.application.revision, action };
              if (action === 'resolve_identity') { body.caregiver_id = idInput.value.trim(); body.identity_verified = verified.checked; }
              const buttons = content.querySelectorAll('button'); buttons.forEach(node => { node.disabled = true; });
              try {
                await json('/api/staff/respite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                await loadPending(eventId);
                if (action === 'confirm' && typeof window.loadRegistrations === 'function') await window.loadRegistrations(eventId, window.currentEventTitle);
              } catch (error) { message.textContent = error.message; buttons.forEach(node => { node.disabled = false; }); }
            });
          }
        } catch (error) { open.disabled = false; card.appendChild(make('p',error.message)); }
      });
    }
  }
  window.LegacyRespite = Object.freeze({ loadPending });
  void initializeForm();
})();
