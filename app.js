/* Legacy Caregiver Hub — demo interactions (sample data only) */

/* ---------- Live intake forms ---------- */
const INTAKE_ENDPOINT = '/api/intake';

function splitName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  return {
    first_name: parts.shift() || '',
    last_name: parts.length ? parts.join(' ') : '',
  };
}

function contactFields(value) {
  const contact = (value || '').trim();
  if (contact.includes('@')) return { email: contact };
  return { phone: contact };
}

function intakeExternalRef(form, kind, eventId) {
  const suffix = eventId ? ':' + eventId : '';
  const key = 'legacy-intake:' + kind + ':' + form.id + suffix;
  let ref = sessionStorage.getItem(key);
  if (!ref) {
    ref = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    sessionStorage.setItem(key, ref);
  }
  return ref;
}

function setFormState(form, state, message) {
  const success = form.querySelector('[data-intake-success]');
  const routing = form.querySelector('[data-intake-routing]');
  const error = form.querySelector('[data-intake-error]');
  const submit = form.querySelector('[type="submit"]');

  if (success) success.style.display = state === 'success' ? 'block' : 'none';
  if (routing) routing.style.display = state === 'success' ? 'block' : 'none';
  if (error) {
    error.textContent = message || '';
    error.style.display = state === 'error' ? 'block' : 'none';
  }
  if (submit) submit.disabled = state === 'pending';
}

function postIntake(form, payload) {
  setFormState(form, 'pending');
  return fetch(INTAKE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(async function (res) {
    const body = await res.json().catch(function () { return {}; });
    if (res.ok && body.ok) return body;
    const err = new Error(body.error || 'intake_failed');
    err.status = res.status;
    throw err;
  });
}

function submitSupport(e) {
  e.preventDefault();
  const form = e.currentTarget || document.getElementById('supportForm');
  const name = splitName(document.getElementById('supName').value);
  const contact = contactFields(document.getElementById('supEmail').value);
  const payload = Object.assign({
    kind: 'support_request',
    source: 'site_form:support',
    external_ref: intakeExternalRef(form, 'support_request'),
    first_name: name.first_name,
    last_name: name.last_name,
    relationship: document.getElementById('supWho').value,
    caring_for: document.getElementById('supWhat').value,
    message: document.getElementById('supMsg').value || document.getElementById('supWhat').value,
  }, contact);

  postIntake(form, payload).then(function () {
    setFormState(form, 'success');
  }).catch(function () {
    setFormState(form, 'error', "We couldn't send this form just now. Please email us and we'll take it from there.");
  });
  return false;
}

function openMembership() {
  const modal = document.getElementById('membershipModal');
  const form = document.getElementById('membershipForm');
  if (form) setFormState(form, 'idle');
  if (modal) modal.classList.add('open');
}

function closeMembership() {
  document.getElementById('membershipModal').classList.remove('open');
}

function submitMembership(e) {
  e.preventDefault();
  const form = e.currentTarget || document.getElementById('membershipForm');
  const name = splitName(document.getElementById('memName').value);
  const payload = {
    kind: 'membership',
    source: 'site_form:membership',
    external_ref: intakeExternalRef(form, 'membership'),
    first_name: name.first_name,
    last_name: name.last_name,
    email: document.getElementById('memEmail').value.trim(),
    caring_for: document.getElementById('memCaringFor').value,
    message: document.getElementById('memNote').value,
  };

  postIntake(form, payload).then(function () {
    setFormState(form, 'success');
  }).catch(function () {
    setFormState(form, 'error', "We couldn't send this form just now. Please email us and we'll take it from there.");
  });
  return false;
}

/* ---------- Resource hub: search + category filter ---------- */
(function () {
  const grid = document.getElementById('resourceGrid');
  if (!grid) return;
  const chips = document.querySelectorAll('.filter-chip');
  const search = document.getElementById('resourceSearch');
  const noResults = document.getElementById('noResults');
  let activeCat = 'all';

  function apply() {
    const q = (search.value || '').toLowerCase().trim();
    let visible = 0;
    grid.querySelectorAll('.resource-item').forEach(function (item) {
      const catOk = activeCat === 'all' || item.dataset.cat === activeCat;
      const textOk = !q || item.textContent.toLowerCase().includes(q);
      const show = catOk && textOk;
      item.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    if (noResults) noResults.style.display = visible === 0 ? 'block' : 'none';
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      chips.forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      activeCat = chip.dataset.cat;
      apply();
    });
  });
  if (search) search.addEventListener('input', apply);
})();

/* ---------- Events: registration modal ---------- */
function openRegister(title, eventId) {
  const modal = document.getElementById('registerModal');
  document.getElementById('regTitle').textContent = 'Register — ' + title;
  const form = document.getElementById('regForm');
  form.dataset.eventId = eventId || '';
  setFormState(form, 'idle');
  modal.classList.add('open');
}
function closeRegister() {
  document.getElementById('registerModal').classList.remove('open');
}
function submitRegister(e) {
  e.preventDefault();
  const form = e.currentTarget || document.getElementById('regForm');
  const name = splitName(document.getElementById('regName').value);
  const eventId = form.dataset.eventId;
  const payload = {
    kind: 'event_registration',
    source: 'site_form:event',
    external_ref: intakeExternalRef(form, 'event_registration', eventId),
    event_id: eventId,
    first_name: name.first_name,
    last_name: name.last_name,
    email: document.getElementById('regEmail').value.trim(),
    relationship: document.getElementById('regRole').value,
  };

  postIntake(form, payload).then(function () {
    setFormState(form, 'success');
  }).catch(function (err) {
    if (err.message === 'event_full') {
      setFormState(form, 'error', 'This event is full. Email us and we will help you find the next opening.');
      return;
    }
    setFormState(form, 'error', "We couldn't complete registration just now. Please email us and we'll take it from there.");
  });
  return false;
}
document.addEventListener('click', function (e) {
  const registerOverlay = document.getElementById('registerModal');
  const membershipOverlay = document.getElementById('membershipModal');
  if (registerOverlay && e.target === registerOverlay) closeRegister();
  if (membershipOverlay && e.target === membershipOverlay) closeMembership();
});

/* ---------- Portal: mock login / dashboard ---------- */
function portalLogin() {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('dashView').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function portalLogout() {
  document.getElementById('dashView').style.display = 'none';
  document.getElementById('loginView').style.display = 'block';
}

/* ---------- Staff console: governed agent chat mock ---------- */
function agentConfirm(btn) {
  const msg = btn.closest('.msg');
  btn.closest('.confirm-row').innerHTML =
    '<span style="font-size:12.5px; font-weight:700; color: var(--green);">✓ Published — logged to the audit trail. Live on the Events page & portal.</span>';
}
function agentCancel(btn) {
  btn.closest('.confirm-row').innerHTML =
    '<span style="font-size:12.5px; font-weight:700; color: var(--ink-soft);">Draft discarded — nothing changed.</span>';
}

function agentSend() {
  const input = document.getElementById('chatInput');
  const body = document.getElementById('chatBody');
  const text = (input.value || '').trim();
  if (!text) return;
  input.value = '';

  const user = document.createElement('div');
  user.className = 'msg user';
  user.textContent = text;
  body.appendChild(user);

  const bot = document.createElement('div');
  bot.className = 'msg bot';

  const t = text.toLowerCase();
  let previewTitle, previewBody;
  if (t.includes('caregiver') && (t.includes('add') || t.includes('new'))) {
    previewTitle = '👤 New Sanctuary member record';
    previewBody = 'Name parsed from your message · programs: as specified<br>Fields: profile, contact, program flags, notes<br>Nothing saved until you confirm.';
  } else if (t.includes('resource') || t.includes('hub')) {
    previewTitle = '📚 Resource hub update';
    previewBody = 'New resource drafted into the category you named.<br>Will appear on the Resource Hub after confirmation.';
  } else if (t.includes('event')) {
    previewTitle = '📅 New event draft';
    previewBody = 'Date, time, and location parsed from your message.<br>Will list on the Events page + portal after confirmation.';
  } else {
    previewTitle = '✏️ Drafted change';
    previewBody = 'Mapped your request to a structured content change.<br>Preview it here — nothing goes live until you confirm.';
  }

  bot.innerHTML =
    'Here\'s a draft — nothing is live yet:' +
    '<div class="preview"><div class="p-title">' + previewTitle + '</div>' + previewBody + '</div>' +
    '<div class="confirm-row">' +
    '<button class="chip-btn chip-confirm" onclick="agentConfirm(this)">Confirm &amp; publish</button>' +
    '<button class="chip-btn chip-cancel" onclick="agentCancel(this)">Discard</button>' +
    '</div>';

  setTimeout(function () {
    body.appendChild(bot);
    body.scrollTop = body.scrollHeight;
  }, 450);
  body.scrollTop = body.scrollHeight;
}

/* ---------- Events live D1 listing ---------- */
function loadLiveEvents() {
  const cards = document.querySelectorAll('.event-card');
  if (!cards.length) return;

  fetch('/api/events')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data.ok || !data.events) return;
      
      data.events.forEach(function (e) {
        const btn = Array.from(document.querySelectorAll('button')).find(function (b) {
          const onclickAttr = b.getAttribute('onclick') || '';
          return onclickAttr.indexOf("'" + e.id + "'") !== -1 || onclickAttr.indexOf('"' + e.id + '"') !== -1;
        });

        if (btn) {
          const container = btn.closest('.event-card') || btn.parentElement;
          const noteSpan = container.querySelector('span.small.muted');
          if (noteSpan) {
            if (e.capacity) {
              noteSpan.textContent = e.registered_count + ' registered · capacity ' + e.capacity;
              if (e.registered_count >= e.capacity) {
                btn.textContent = 'Full';
                btn.disabled = true;
                btn.className = 'btn btn-outline btn-sm';
                btn.onclick = null;
              }
            } else {
              noteSpan.textContent = e.registered_count + ' registered';
            }
          }
        }
      });
    })
    .catch(function (err) {
      console.error('Failed to load live events from D1:', err);
    });
}

document.addEventListener('DOMContentLoaded', loadLiveEvents);

