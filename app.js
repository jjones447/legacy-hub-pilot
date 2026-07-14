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

/* ---------- Portal: Magic-link login, logout, and session check ---------- */

function checkPortalSession() {
  const loginView = document.getElementById('loginView');
  const dashView = document.getElementById('dashView');
  if (!loginView || !dashView) return; // not on portal page

  fetch('/api/portal/me')
    .then(function (res) {
      if (res.status === 200) {
        return res.json();
      }
      throw new Error('unauthorized');
    })
    .then(function (data) {
      if (data.ok) {
        renderPortalData(data);
        loginView.style.display = 'none';
        dashView.style.display = 'block';
      } else {
        dashView.style.display = 'none';
        loginView.style.display = 'block';
      }
    })
    .catch(function () {
      dashView.style.display = 'none';
      loginView.style.display = 'block';
    });
}

function submitPortalLogin(e) {
  if (e) e.preventDefault();
  const emailInput = document.getElementById('loginEmail');
  const statusDiv = document.getElementById('loginStatus');
  const btn = document.getElementById('loginBtn');
  if (!emailInput || !statusDiv) return;

  const email = (emailInput.value || '').trim();
  if (!email || !email.includes('@')) {
    statusDiv.style.display = 'block';
    statusDiv.style.background = '#fee2e2';
    statusDiv.style.color = '#b91c1c';
    statusDiv.textContent = 'Please enter a valid email address.';
    return;
  }

  statusDiv.style.display = 'block';
  statusDiv.style.background = '#f3f4f6';
  statusDiv.style.color = '#4b5563';
  statusDiv.textContent = 'Sending sign-in link...';
  if (btn) btn.disabled = true;

  fetch('/api/portal/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: email })
  })
    .then(function (res) {
      if (res.status === 429) {
        throw new Error('rate_limited');
      }
      return res.json();
    })
    .then(function (data) {
      if (data.ok) {
        statusDiv.style.background = '#dcfce7';
        statusDiv.style.color = '#15803d';

        if (data.dev_link) {
          statusDiv.innerHTML = 'Success! Link generated for demo mode:<br><a href="' + data.dev_link + '" class="btn btn-plum btn-sm mt-8" style="display:inline-block; text-decoration:none;">Click here to sign in</a>';
        } else {
          statusDiv.textContent = "If you're a member, check your email for a secure sign-in link!";
        }
      } else {
        throw new Error(data.error || 'Failed to request link.');
      }
    })
    .catch(function (err) {
      statusDiv.style.background = '#fee2e2';
      statusDiv.style.color = '#b91c1c';
      if (err.message === 'rate_limited') {
        statusDiv.textContent = 'Too many requests. Please wait a few minutes and try again.';
      } else {
        statusDiv.textContent = "We couldn't request a sign-in link just now. Please try again later.";
      }
    })
    .finally(function () {
      if (btn) btn.disabled = false;
    });
}

function portalLogout() {
  fetch('/api/portal/logout', { method: 'POST' })
    .then(function () {
      const loginView = document.getElementById('loginView');
      const dashView = document.getElementById('dashView');
      const statusDiv = document.getElementById('loginStatus');
      const emailInput = document.getElementById('loginEmail');

      if (statusDiv) statusDiv.style.display = 'none';
      if (emailInput) emailInput.value = '';

      if (dashView) dashView.style.display = 'none';
      if (loginView) loginView.style.display = 'block';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

function renderPortalData(data) {
  const welcome = document.getElementById('portalWelcome');
  if (welcome) {
    welcome.textContent = 'Welcome back, ' + (data.profile.first_name || 'Member');
  }

  // Membership status
  const memberStatus = document.getElementById('portalMembershipStatus');
  if (memberStatus) {
    if (data.profile.sanctuary_member === 1) {
      memberStatus.innerHTML = '<span class="badge badge-green">Sanctuary member</span>';
    } else {
      memberStatus.innerHTML = '<span class="badge badge-gray">Non-member</span>';
    }
  }

  // Grant status
  const grantStatus = document.getElementById('portalGrantStatus');
  const grantRequestedFor = document.getElementById('portalGrantRequestedFor');
  const grantAward = document.getElementById('portalGrantAward');
  if (grantStatus && grantRequestedFor && grantAward) {
    if (data.grants && data.grants.length > 0) {
      const ga = data.grants[0];
      let badgeClass = 'badge-gray';
      if (ga.status === 'submitted' || ga.status === 'in_review') badgeClass = 'badge-amber';
      else if (ga.status === 'awarded') badgeClass = 'badge-green';

      grantStatus.innerHTML = '<span class="badge ' + badgeClass + '">' + ga.status.replace('_', ' ') + '</span>';
      grantRequestedFor.textContent = ga.requested_for || 'Wellness grant';
      grantAward.textContent = ga.amount ? 'Awarded: ' + ga.amount + ' (' + (ga.care_package || 'No package') + ')' : 'Personalized on approval';
    } else {
      grantStatus.innerHTML = '<span class="badge badge-gray">No application</span>';
      grantRequestedFor.textContent = '—';
      grantAward.textContent = '—';
    }
  }

  // Events list
  const eventsList = document.getElementById('portalEventsList');
  if (eventsList) {
    eventsList.innerHTML = '';
    if (data.events && data.events.length > 0) {
      data.events.forEach(function (e) {
        const item = document.createElement('div');
        item.className = 'timeline-item';
        let dotColor = 'var(--ink-soft)';
        if (e.type === 'support_group') dotColor = 'var(--green)';
        else if (e.type === 'memory_social') dotColor = 'var(--amber)';
        else if (e.type === 'wellness') dotColor = 'var(--plum)';

        item.innerHTML = '<div class="timeline-dot" style="background: ' + dotColor + ';"></div>' +
                         '<div><strong>' + e.title + '</strong> <span class="badge badge-green">' + e.registration_status + '</span>' +
                         '<div class="when">' + e.starts_at + ' · ' + (e.location || 'Online') + '</div></div>';
        eventsList.appendChild(item);
      });
    } else {
      eventsList.innerHTML = '<p class="small muted" style="margin:0;">No registered events yet.</p>';
    }
  }

  // Memory socials count and details
  const socialsCount = document.getElementById('portalSocialsCount');
  const socialsLast = document.getElementById('portalSocialsLastVisit');
  const socialsNext = document.getElementById('portalSocialsNext');
  if (socialsCount && socialsLast && socialsNext) {
    const socials = (data.events || []).filter(function (e) { return e.type === 'memory_social'; });
    const attended = socials.filter(function (e) { return e.registration_status === 'attended'; });
    const registered = socials.filter(function (e) { return e.registration_status === 'registered'; });

    socialsCount.textContent = attended.length + ' socials';

    const last = attended.sort(function (a, b) { return new Date(b.starts_at) - new Date(a.starts_at); })[0];
    socialsLast.textContent = last ? last.starts_at.slice(0, 10) : '—';

    const next = registered.sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); })[0];
    socialsNext.textContent = next ? next.title + ' · ' + next.starts_at.slice(0, 10) : '—';
  }
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

document.addEventListener('DOMContentLoaded', function() {
  loadLiveEvents();
  checkPortalSession();
});

