/* Profile answers stay in this page's memory; no browser storage or automatic saves. */
(function () {
  'use strict';
  window.createCaregiverProfileEditor = function (root, options) {
    const request = options.fetch || window.fetch.bind(window);
    const epoch = options.epoch;
    let generation = 0, available = false, saving = false, locked = false;
    let fields = {}, saved = {}, sections = [], revision = 0, controls = new Map();
    let form, status, progress, saveButton, reloadButton;
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const visible = field => !(field.currentCare && ['No', 'I was previously a caregiver', 'Prefer not to answer'].includes(fields.currently_caring))
      && (!field.dependsOn || field.visibleWhen.some(value => Array.isArray(fields[field.dependsOn])
        ? fields[field.dependsOn].includes(value) : fields[field.dependsOn] === value));
    const dirty = () => sections.some(s => s.fields.some(f => !f.readOnly && visible(f) && !same(fields[f.key], saved[f.key])));
    function node(tag, text, className) {
      const el = document.createElement(tag);
      if (text !== undefined) el.textContent = text;
      if (className) el.className = className;
      return el;
    }
    function clear() {
      generation += 1; available = false; saving = false; locked = false;
      fields = {}; saved = {}; sections = []; controls.clear(); root.replaceChildren(); root.hidden = true;
      if (options.available) options.available(false);
    }
    function announce(text, error) {
      status.textContent = text; status.setAttribute('role', error ? 'alert' : 'status');
    }
    function refresh() {
      controls.forEach(({ field, wrap, inputs }) => {
        const show = visible(field); wrap.hidden = !show;
        inputs.forEach(input => { input.disabled = saving || locked || !show; });
      });
      const required = sections.flatMap(s => s.fields).filter(f => f.required);
      const answered = required.filter(f => typeof fields[f.key] === 'string' && fields[f.key].trim()).length;
      progress.textContent = answered + ' of ' + required.length + ' required details provided. All other questions are optional.';
      saveButton.disabled = saving || locked || !dirty();
      reloadButton.disabled = saving;
    }
    function changed(field, value, changedInput) {
      const control = controls.get(field.key);
      control.error.hidden = true; control.error.textContent = '';
      control.inputs.forEach(input => input.removeAttribute('aria-invalid'));
      fields[field.key] = value;
      if (field.type === 'multi' && changedInput.checked) {
        const exclusive = field.exclusive || ['Prefer not to answer'];
        fields[field.key] = exclusive.includes(changedInput.value) ? [changedInput.value] : value.filter(v => !exclusive.includes(v));
        controls.get(field.key).inputs.forEach(input => { input.checked = fields[field.key].includes(input.value); });
      }
      announce('You have unsaved changes.'); refresh();
    }
    function render() {
      root.replaceChildren(); root.hidden = false;
      root.append(node('p', 'You can save a little at a time and return later. Saving does not enroll you in a program or send an email.'));
      progress = node('p', '', 'small'); progress.setAttribute('aria-live', 'polite'); root.append(progress);
      form = node('form'); form.noValidate = true;
      sections.forEach((section, index) => {
        const details = node('details', undefined, 'profile-section'); details.open = index === 0;
        details.append(node('summary', section.title));
        if (section.intro) details.append(node('p', section.intro));
        if (section.key !== 'demographics') details.append(node('p', 'Optional — sharing this helps us support you better.', 'profile-optional-help'));
        section.fields.forEach(field => {
          const multi = field.type === 'multi';
          const wrap = node(multi ? 'fieldset' : 'div', undefined, 'profile-field');
          const label = node(multi ? 'legend' : 'label', field.label + (field.required ? ' (needed to complete your profile)' : ' (optional)'));
          const id = 'caregiver-profile-' + field.key;
          if (!multi) label.htmlFor = id;
          wrap.append(label); const inputs = [];
          if (multi) {
            field.options.forEach((value, position) => {
              const choice = node('label', undefined, 'profile-choice');
              const input = node('input'); input.type = 'checkbox'; input.value = value; input.id = id + '-' + position;
              input.checked = Array.isArray(fields[field.key]) && fields[field.key].includes(value);
              choice.append(input, document.createTextNode(' ' + value)); wrap.append(choice); inputs.push(input);
              input.addEventListener('change', () => changed(field, inputs.filter(x => x.checked).map(x => x.value), input));
            });
          } else {
            const input = node(field.type === 'select' ? 'select' : field.multiline ? 'textarea' : 'input');
            input.id = id; input.name = field.key;
            if (field.type === 'select') {
              const blank = node('option', 'Select an answer'); blank.value = ''; input.append(blank);
              field.options.forEach(value => { const opt = node('option', value); opt.value = value; input.append(opt); });
            } else if (!field.multiline) input.type = ['date', 'email'].includes(field.type) ? field.type : 'text';
            input.value = fields[field.key] ?? '';
            if (field.maxLength) input.maxLength = field.maxLength;
            if (field.inputMode) input.inputMode = field.inputMode;
            if (field.readOnly) {
              input.readOnly = true;
              const hint = node('p', 'Your sign-in email is read-only.', 'small muted'); hint.id = id + '-hint';
              input.setAttribute('aria-describedby', hint.id); wrap.append(hint);
            } else input.addEventListener(field.type === 'select' ? 'change' : 'input', () => changed(field, input.value));
            wrap.append(input); inputs.push(input);
          }
          if (field.restricted) wrap.append(node('p', 'You and authorized admin staff can see this answer. Other staff see aggregate information only.', 'small muted'));
          const error = node('p', '', 'small'); error.id = id + '-error'; error.hidden = true;
          inputs.forEach(input => input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' ')));
          wrap.append(error);
          controls.set(field.key, { field, wrap, inputs, error }); details.append(wrap);
        });
        form.append(details);
      });
      status = node('p', '', 'profile-save-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      saveButton = node('button', 'Save my profile', 'btn btn-plum'); saveButton.type = 'submit';
      reloadButton = node('button', 'Reload saved answers (discard unsaved changes)', 'btn btn-outline'); reloadButton.type = 'button';
      reloadButton.addEventListener('click', () => { void load(); });
      const actions = node('div', undefined, 'profile-actions'); actions.append(saveButton, reloadButton);
      form.append(status, actions); form.addEventListener('submit', save); root.append(form); refresh();
    }
    async function load() {
      const token = ++generation, ownerEpoch = epoch();
      // Explicit reload clears the old answers before requesting the current owner.
      available = false; fields = {}; saved = {}; controls.clear(); root.replaceChildren(); root.hidden = false;
      root.append(node('p', 'Loading your saved profile…', 'small'));
      try {
        const res = await request('/api/portal/profile', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
        if (token !== generation || ownerEpoch !== epoch()) return;
        if (res.status === 404) { clear(); return; }
        if (res.status === 401 || res.status === 403) { clear(); return; }
        const data = await res.json();
        if (token !== generation || ownerEpoch !== epoch()) return;
        if (res.status !== 200 || res.redirected || !data?.ok || !Number.isInteger(data.profile?.revision)
            || !data.profile.fields || !Array.isArray(data.sections)) throw new Error('profile_unavailable');
        sections = data.sections; fields = JSON.parse(JSON.stringify(data.profile.fields)); saved = JSON.parse(JSON.stringify(fields));
        revision = data.profile.revision; saving = false; locked = false; available = true; render();
        announce('Your saved answers are ready.');
        if (options.available) options.available(true);
      } catch {
        if (token !== generation || ownerEpoch !== epoch()) return;
        root.replaceChildren(node('p', 'Your profile could not be loaded. Please try again later.', 'small'));
        const retry = node('button', 'Load saved profile', 'btn btn-outline'); retry.type = 'button'; retry.addEventListener('click', () => { void load(); }); root.append(retry);
      }
    }
    function validateAnswers() {
      let first = null, count = 0;
      controls.forEach(({ field, wrap, inputs, error }) => {
        error.hidden = true; error.textContent = ''; inputs.forEach(input => input.removeAttribute('aria-invalid'));
        if (field.readOnly || !visible(field) || same(fields[field.key], saved[field.key])) return;
        const value = fields[field.key]; let message = '';
        if (value !== null && value !== '' && value !== undefined) {
          if (field.key === 'zip' && !/^\d{5}(?:-\d{4})?$/.test(String(value).trim())) message = 'Enter a five-digit ZIP code, with an optional four-digit extension.';
          else if (field.type === 'date') {
            const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00Z') : null;
            if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value > new Date().toISOString().slice(0, 10)) message = 'Enter a valid date that is today or earlier.';
          } else if (typeof value === 'string' && field.maxLength && value.length > field.maxLength) message = 'Use ' + field.maxLength + ' characters or fewer.';
          if (!message && typeof value === 'string' && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) message = 'Remove unsupported control characters.';
        }
        if (inputs.some(input => input.validity?.badInput)) message = 'Enter a valid answer or clear this optional field.';
        if (!message) return;
        count++; error.textContent = message; error.hidden = false;
        inputs.forEach(input => input.setAttribute('aria-invalid', 'true'));
        if (!first) first = { input: inputs[0], section: wrap.closest('details') };
      });
      if (!first) return true;
      first.section.open = true; first.input.focus(); announce('Check ' + count + ' highlighted answer' + (count === 1 ? '.' : 's.'), true); return false;
    }
    async function save(event) {
      event.preventDefault();
      if (!available || saving || locked || !dirty() || !validateAnswers()) return;
      const token = generation, ownerEpoch = epoch(), patch = {};
      sections.forEach(s => s.fields.forEach(f => {
        if (!f.readOnly && visible(f) && !same(fields[f.key], saved[f.key])) patch[f.key] = fields[f.key];
      }));
      saving = true; refresh(); announce('Saving your profile…');
      try {
        const res = await request('/api/portal/profile', { method: 'POST', credentials: 'same-origin', redirect: 'error',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, fields: patch }) });
        if (token !== generation || ownerEpoch !== epoch()) return;
        if (res.status === 401 || res.status === 403) { clear(); return; }
        if (res.status === 409) {
          locked = true; announce('Your saved profile changed elsewhere. Reload saved answers before making further changes.', true); return;
        }
        if (res.status === 400 || res.status === 413) {
          announce('Some answers could not be saved. Check your entries and shorten any long answers, then try again.', true); return;
        }
        const data = await res.json();
        if (token !== generation || ownerEpoch !== epoch()) return;
        if (res.status !== 200 || res.redirected || data?.ok !== true || data.revision !== revision + 1) throw new Error('save_unknown');
        await load();
        if (ownerEpoch === epoch() && available) announce('Your profile is saved. You can return and continue later.');
      } catch {
        if (token !== generation || ownerEpoch !== epoch()) return;
        locked = true; announce('Save could not be confirmed. Reload saved answers before saving again.', true);
      } finally {
        if (token === generation && ownerEpoch === epoch() && available) { saving = false; refresh(); }
      }
    }
    window.addEventListener('beforeunload', event => {
      if (available && dirty()) { event.preventDefault(); event.returnValue = ''; }
    });
    return { load, clear, get available() { return available; } };
  };
}());
