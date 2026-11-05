
/* Muted hero playback is optional: reduced-motion visitors keep native Play. */
function initializeMotionVideo() {
  if (typeof window === 'undefined' || !window.matchMedia) return;
  const videos = document.querySelectorAll('video[data-motion-autoplay]');
  if (!videos.length) return;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const applyPreference = () => {
    for (const video of videos) {
      video.autoplay = !preference.matches;
      // Native controls (and their Play button) only when motion is reduced. If the browser
      // refuses autoplay, the first frame stays and a tap, click, Enter or Space plays it.
      video.controls = preference.matches;
      if (preference.matches) {
        video.pause();
      } else {
        video.muted = true;
        // Browser/data-saving policies may still require the native Play control.
        const playback = video.play();
        if (playback && playback.catch) playback.catch(() => {});
      }
    }
  };
  applyPreference();
  preference.addEventListener('change', applyPreference);
  // Without visible controls, a click, tap, Enter or Space pauses and resumes the video.
  const toggle = (video) => {
    if (video.controls) return;
    if (video.paused) {
      const playback = video.play();
      if (playback && playback.catch) playback.catch(() => { video.controls = true; });
    } else {
      video.pause();
    }
  };
  for (const video of videos) {
    if (typeof video.addEventListener !== 'function') continue;
    video.addEventListener('click', () => toggle(video));
    video.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(video); }
    });
  }
}
initializeMotionVideo();

/* Header videos play at the rate the page sets in data-playback-rate (0 < rate <= 1).
   Loading media resets playbackRate to defaultPlaybackRate, so both are set. */
function initializeHeroVideoRate() {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
  const videos = document.querySelectorAll('video[data-playback-rate]');
  if (!videos || !videos.length) return;
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const rate = Number(video.dataset && video.dataset.playbackRate);
    if (!(rate > 0 && rate <= 1)) continue;
    video.defaultPlaybackRate = rate;
    video.playbackRate = rate;
  }
}
initializeHeroVideoRate();

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
  const form = document.getElementById('supportForm');
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

const membershipSubmissions = new WeakMap();

function showMembershipState(form, state, focusResult) {
  membershipSubmissions.set(form, state);
  setFormState(form, state.phase === 'unknown' ? 'error' : state.phase, state.message);
  const pending = form.querySelector('[data-membership-pending]');
  if (pending) pending.hidden = state.phase !== 'pending';
  const submit = form.querySelector('[type="submit"]');
  if (submit) submit.disabled = ['pending', 'unknown', 'success'].includes(state.phase);
  form.ariaBusy = state.phase === 'pending' ? 'true' : 'false';
  const result = form.querySelector(state.phase === 'success' ? '[data-intake-success]' : '[data-intake-error]');
  if (state.phase === 'success' && result) result.textContent = state.message;
  if (focusResult && result && typeof result.focus === 'function') result.focus();
}

function openMembership() {
  const modal = document.getElementById('membershipModal');
  const form = document.getElementById('membershipForm');
  if (modal) modal.classList.add('open');
  if (form) showMembershipState(form, membershipSubmissions.get(form) || { phase: 'idle' });
}

function closeMembership() {
  document.getElementById('membershipModal').classList.remove('open');
}

function openGrantApply() {
  const modal = document.getElementById('grantApplyModal');
  const form = document.getElementById('grantApplyForm');
  if (form) setFormState(form, 'idle');
  if (modal) modal.classList.add('open');
}

function closeGrantApply() {
  const modal = document.getElementById('grantApplyModal');
  if (modal) modal.classList.remove('open');
}

function submitGrantApply(e) {
  e.preventDefault();
  const form = document.getElementById('grantApplyForm');
  const name = splitName(document.getElementById('grantName').value);
  const payload = {
    kind: 'grant_application',
    source: 'site_form:grant',
    external_ref: intakeExternalRef(form, 'grant_application'),
    first_name: name.first_name,
    last_name: name.last_name,
    email: document.getElementById('grantEmail').value.trim(),
    requested_for: document.getElementById('grantRequestedFor').value.trim() || null,
  };

  postIntake(form, payload).then(function () {
    setFormState(form, 'success');
  }).catch(function () {
    setFormState(form, 'error', "We couldn't send this application just now. Please email us and we'll take it from there.");
  });
  return false;
}

function openCoachingInterest() {
  const modal = document.getElementById('coachingInterestModal');
  const form = document.getElementById('coachingInterestForm');
  if (form) setFormState(form, 'idle');
  if (modal) modal.classList.add('open');
}

function closeCoachingInterest() {
  const modal = document.getElementById('coachingInterestModal');
  if (modal) modal.classList.remove('open');
}

function submitCoachingInterest(e) {
  e.preventDefault();
  const form = document.getElementById('coachingInterestForm');
  const name = splitName(document.getElementById('coachName').value);
  const note = document.getElementById('coachNote').value.trim();
  const payload = {
    kind: 'support_request',
    source: 'site_form:coaching',
    external_ref: intakeExternalRef(form, 'support_request'),
    first_name: name.first_name,
    last_name: name.last_name,
    email: document.getElementById('coachEmail').value.trim(),
    message: note ? ('Coaching interest list — ' + note) : 'Coaching interest list',
  };

  postIntake(form, payload).then(function () {
    setFormState(form, 'success');
  }).catch(function () {
    setFormState(form, 'error', "We couldn't join the list just now. Please email us and we'll take it from there.");
  });
  return false;
}

const PORTAL_HANDOFF_KEY = 'legacy-portal-handoff';
const PORTAL_HANDOFF_MAX_AGE_MS = 10 * 60 * 1000;

function handOffMembershipToPortal(email) {
  try {
    if (!email || !email.includes('@')) return;
    sessionStorage.setItem(PORTAL_HANDOFF_KEY, JSON.stringify({ email: email, at: Date.now() }));
    if (typeof window !== 'undefined' && window.location && typeof window.location.assign === 'function') {
      window.location.assign('/portal');
    }
  } catch (err) { /* stay on the saved-membership message; the continuation link still works */ }
}

// Read and remove the one-time membership hand-off. Returns the email or null.
function takePortalHandoff(now) {
  try {
    const raw = sessionStorage.getItem(PORTAL_HANDOFF_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PORTAL_HANDOFF_KEY);
    const data = JSON.parse(raw);
    const age = (now || Date.now()) - Number(data && data.at);
    if (!data || typeof data.email !== 'string' || !data.email.includes('@') || !(age >= 0 && age <= PORTAL_HANDOFF_MAX_AGE_MS)) return null;
    return data.email.trim();
  } catch (err) {
    return null;
  }
}

function submitMembership(e) {
  e.preventDefault();
  const form = document.getElementById('membershipForm');
  if (!form || ['pending', 'unknown', 'success'].includes(membershipSubmissions.get(form)?.phase)) return false;
  let payload;
  try {
    const name = splitName(document.getElementById('memName').value);
    payload = {
      kind: 'membership',
      source: 'site_form:membership',
      external_ref: intakeExternalRef(form, 'membership'),
      first_name: name.first_name,
      last_name: name.last_name,
      email: document.getElementById('memEmail').value.trim(),
      caring_for: document.getElementById('memCaringFor').value,
      message: document.getElementById('memNote').value,
    };
  } catch {
    // No request has started. In particular, do not silently replace a failed
    // persistent retry key with a new identity and risk a duplicate later.
    showMembershipState(form, { phase: 'error', message: "We couldn't prepare this form. It has not been sent. Please contact Legacy for help." }, true);
    return false;
  }
  showMembershipState(form, { phase: 'pending' });
  const uncertain = () => showMembershipState(form, {
    phase: 'unknown', message: "We can't confirm whether your membership request was saved. Please don't submit it again. Contact Legacy so we can check it for you."
  }, true);
  // This is a UI deadline, not a cancellation or permission to replay a write.
  // A late response can still establish the original request's outcome.
  const timer = setTimeout(uncertain, 20000);
  Promise.resolve().then(() => postIntake(form, payload)).then(function (result) {
    showMembershipState(form, { phase: 'success', message: result.duplicate
      ? 'A membership request was already received from this browser session. Continue to the portal and sign in with the email used for that request. Contact Legacy if you need to change it.'
      : 'Your membership request is saved. Taking you to your portal to request your secure sign-in link…' }, true);
    // Requested by Legacy (Oct 30): after a NEW membership is saved, go straight to the portal
    // sign-in with the email filled in and one sign-in link requested. The email travels in
    // sessionStorage only (never in the URL), and the portal never signs anyone in without
    // the emailed link.
    if (!result.duplicate) handOffMembershipToPortal(payload.email);
  }).catch(function (error) {
    // Timeout/conflict and unrecognized statuses are not proof that no write
    // occurred. Only recognized request refusals permit a deliberate retry.
    if ([400, 401, 403, 404, 405, 413, 415, 422, 429].includes(error.status)) {
      showMembershipState(form, { phase: 'error', message: "We couldn't accept this form. Please check your details or contact Legacy for help." }, true);
    } else {
      // A dropped response or server fault can follow a committed write.
      uncertain();
    }
  }).finally(function () {
    clearTimeout(timer);
  });
  return false;
}

/* ---------- Email list (schema 0020): join from the home page, leave from your own link ---------- */
// Joining saves an email_subscriber row only (no caregiver record) and sends no email.
// The retry key lives in sessionStorage, so a retry after an error cannot add a second row.
const emailListSubmissions = new WeakMap();

function showEmailListState(form, state, focusResult) {
  emailListSubmissions.set(form, state);
  setFormState(form, state.phase, state.message);
  const pending = form.querySelector('[data-email-list-pending]');
  if (pending) pending.hidden = state.phase !== 'pending';
  const submit = form.querySelector('[type="submit"]');
  if (submit) submit.disabled = ['pending', 'success'].includes(state.phase);
  form.ariaBusy = state.phase === 'pending' ? 'true' : 'false';
  const result = form.querySelector(state.phase === 'success' ? '[data-intake-success]' : '[data-intake-error]');
  if (focusResult && result && typeof result.focus === 'function') result.focus();
}

// The sign-up form ships with its button disabled and no named fields (#302 review P3); it is
// enabled only once this script is running and the submit dispatcher handles it.
function initEmailListForm() {
  const form = typeof document !== 'undefined' && document.getElementById ? document.getElementById('emailListForm') : null;
  if (!form) return;
  const submit = form.querySelector('[type="submit"]');
  const note = form.querySelector('[data-email-list-not-ready]');
  if (submit) submit.disabled = false;
  if (note) note.hidden = true;
}

function submitEmailList(e) {
  e.preventDefault();
  const form = document.getElementById('emailListForm');
  if (!form || ['pending', 'success'].includes(emailListSubmissions.get(form)?.phase)) return false;
  let payload;
  try {
    const email = document.getElementById('emailListEmail').value.trim();
    if (!email || !email.includes('@')) {
      showEmailListState(form, { phase: 'error', message: 'Please enter your email address.' }, true);
      return false;
    }
    payload = {
      kind: 'newsletter',
      source: 'site_form:newsletter',
      external_ref: intakeExternalRef(form, 'newsletter'),
      first_name: document.getElementById('emailListFirstName').value.trim(),
      email: email,
    };
  } catch {
    showEmailListState(form, { phase: 'error', message: "We couldn't prepare this form. It has not been sent. Please try again or contact Legacy." }, true);
    return false;
  }
  showEmailListState(form, { phase: 'pending' });
  Promise.resolve().then(() => postIntake(form, payload)).then(function () {
    showEmailListState(form, { phase: 'success' }, true);
  }).catch(function (error) {
    showEmailListState(form, { phase: 'error', message: error && error.status === 429
      ? 'Too many sign-ups from this connection just now. Please try again later.'
      : "We couldn't add you to the email list just now. Please try again in a moment." }, true);
  });
  return false;
}

const UNSUBSCRIBE_ENDPOINT = '/api/unsubscribe';
let unsubscribeToken = null;

// Read the token once, then drop it from the address bar so it is not left in history or
// shared by copying the URL. Nothing is sent until the person presses Unsubscribe.
function initUnsubscribePage(loc, hist) {
  const form = typeof document !== 'undefined' && document.getElementById ? document.getElementById('unsubscribeForm') : null;
  if (!form) return;
  let token = null;
  try {
    token = new URLSearchParams((loc && loc.search) || '').get('token');
  } catch (err) {
    token = null;
  }
  if (token !== null && hist && typeof hist.replaceState === 'function') {
    try { hist.replaceState(null, '', loc.pathname); } catch (err) { /* the page still works */ }
  }
  unsubscribeToken = typeof token === 'string' && /^[0-9a-f]{32}$/.test(token) ? token : null;
  const ready = form.querySelector('[data-unsubscribe-ready]');
  const missing = form.querySelector('[data-unsubscribe-missing]');
  const submit = form.querySelector('[type="submit"]');
  if (ready) ready.hidden = !unsubscribeToken;
  if (missing) missing.hidden = !!unsubscribeToken;
  if (submit) submit.disabled = !unsubscribeToken;
}

function submitUnsubscribe(e) {
  e.preventDefault();
  const form = document.getElementById('unsubscribeForm');
  if (!form || !unsubscribeToken) return false;
  const pending = form.querySelector('[data-unsubscribe-pending]');
  const submit = form.querySelector('[type="submit"]');
  setFormState(form, 'pending');
  if (pending) pending.hidden = false;
  form.ariaBusy = 'true';
  const finish = function (state, message) {
    setFormState(form, state, message);
    if (pending) pending.hidden = true;
    form.ariaBusy = 'false';
    if (submit) submit.disabled = state === 'success';
    const result = form.querySelector(state === 'success' ? '[data-intake-success]' : '[data-intake-error]');
    if (result && typeof result.focus === 'function') result.focus();
  };
  Promise.resolve().then(() => fetch(UNSUBSCRIBE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: unsubscribeToken }),
  })).then(async function (res) {
    const body = await res.json().catch(function () { return {}; });
    if (res.ok && body.ok) finish('success');
    else finish('error', res.status === 429
      ? 'Too many requests from this connection just now. Please try again later.'
      : "We couldn't process this link. Please contact Legacy and we'll remove you.");
  }).catch(function () {
    finish('error', "We couldn't reach Legacy just now. Please try again in a moment.");
  });
  return false;
}

/* ---------- Virtual support group: sign up (saved for staff), then go to Google Meet ---------- */
let supportGroupInterestOpener = null;
let supportGroupSession = '';
let supportGroupSessionDate = null;

function openSupportGroupInterest(opener) {
  const dialog = document.getElementById('supportGroupInterestModal');
  const form = document.getElementById('supportGroupInterestForm');
  if (!dialog || !form || dialog.open) return;
  supportGroupInterestOpener = opener || document.activeElement;
  // A clicked session date (data-session) is shown in the form and saved with the sign-up.
  const session = opener && typeof opener.getAttribute === 'function' ? opener.getAttribute('data-session') : '';
  supportGroupSession = typeof session === 'string' ? session.trim().slice(0, 120) : '';
  // Structured date (YYYY-MM-DD) for the backend; null for general joining without a date.
  const sessionDate = opener && typeof opener.getAttribute === 'function' ? opener.getAttribute('data-session-date') : null;
  supportGroupSessionDate = supportGroupSession && typeof sessionDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sessionDate) ? sessionDate : null;
  const note = document.getElementById('supportGroupSession');
  if (note) {
    note.textContent = supportGroupSession ? 'Session: ' + supportGroupSession : '';
    note.hidden = !supportGroupSession;
  }
  setFormState(form, 'idle');
  dialog.showModal();
  document.getElementById('supportGroupName').focus();
}

// Support-group dates: hide past sessions, show only the next one, and let
// "View upcoming sessions" reveal the rest. Without JavaScript every date stays visible.
function supportGroupToday() {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

function applySupportGroupSessions(expanded, today) {
  const list = document.getElementById('supportGroupSessions');
  if (!list) return;
  const more = document.getElementById('supportGroupSessionsMore');
  const none = document.getElementById('supportGroupSessionsNone');
  const day = today || supportGroupToday();
  const upcoming = Array.from(list.querySelectorAll('li[data-date]')).filter(function (li) {
    const keep = li.getAttribute('data-date') >= day;
    li.hidden = !keep;
    return keep;
  });
  upcoming.forEach(function (li, i) { li.hidden = !expanded && i > 0; });
  if (none) none.classList.toggle('d-none', upcoming.length > 0);
  if (more) {
    more.hidden = upcoming.length < 2;
    more.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }
}
applySupportGroupSessions(false);

function toggleSupportGroupSessions(button) {
  applySupportGroupSessions(button.getAttribute('aria-expanded') !== 'true');
}

function closeSupportGroupInterest() {
  const dialog = document.getElementById('supportGroupInterestModal');
  if (dialog && dialog.open) dialog.close();
}

(function () {
  const dialog = document.getElementById('supportGroupInterestModal');
  if (!dialog) return;
  dialog.addEventListener('close', function () {
    if (supportGroupInterestOpener) supportGroupInterestOpener.focus();
    supportGroupInterestOpener = null;
  });
})();

function submitSupportGroupInterest(e) {
  e.preventDefault();
  const form = document.getElementById('supportGroupInterestForm');
  const name = splitName(document.getElementById('supportGroupName').value);
  const payload = {
    kind: 'support_request',
    source: 'site_form:support_group',
    // One sign-up identity per selected date (and one for general joining), so signing up
    // for a second date in the same tab is a new sign-up, not a duplicate of the first.
    external_ref: intakeExternalRef(form, 'support_request', supportGroupSessionDate),
    session_date: supportGroupSessionDate,
    first_name: name.first_name,
    last_name: name.last_name,
    email: document.getElementById('supportGroupEmail').value.trim(),
    message: 'Signed up for the Virtual Caregiver Support Group' + (supportGroupSession ? ' — ' + supportGroupSession : ''),
  };
  postIntake(form, payload).then(function () {
    setFormState(form, 'success');
    // Only after the sign-up is saved: take the caregiver straight to the group on Google Meet.
    const meet = form.querySelector('[data-intake-routing] a[href^="https://meet.google.com/"]');
    if (meet && typeof window !== 'undefined' && window.location && typeof window.location.assign === 'function') {
      window.location.assign(meet.getAttribute('href'));
    }
  }).catch(function () {
    setFormState(form, 'error', "We couldn't save your request just now. Please contact Legacy if you need help.");
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
  const form = document.getElementById('regForm');
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
  const grantOverlay = document.getElementById('grantApplyModal');
  const coachingOverlay = document.getElementById('coachingInterestModal');
  if (registerOverlay && e.target === registerOverlay) closeRegister();
  if (membershipOverlay && e.target === membershipOverlay) closeMembership();
  if (grantOverlay && e.target === grantOverlay) closeGrantApply();
  if (coachingOverlay && e.target === coachingOverlay) closeCoachingInterest();
});

/* ---------- Portal: Magic-link login, logout, and session check ---------- */

function checkPortalSession() {
  const loginView = document.getElementById('loginView');
  const dashView = document.getElementById('dashView');
  if (!loginView || !dashView) return; // not on portal page

  const checkGen = typeof bumpPortalSessionGeneration === 'function' ? bumpPortalSessionGeneration() : 0;

  // Only a confirmed signed-out answer (HTTP 401) may start the one automatic sign-in
  // link request from a membership hand-off. A signed-in session discards the hand-off;
  // an unavailable or unreadable session check only prefills the email (manual send).
  fetch('/api/portal/me')
    .then(function (res) {
      if (res.status === 200) {
        return res.json().then(function (data) { return { outcome: data && data.ok ? 'signed_in' : 'unavailable', data: data }; });
      }
      return { outcome: res.status === 401 ? 'signed_out' : 'unavailable' };
    })
    .then(function (result) {
      if (typeof portalSessionGeneration === 'number' && checkGen && checkGen !== portalSessionGeneration) return;
      if (result.outcome === 'signed_in') {
        takePortalHandoff(); // discard: an existing session wins, nothing is sent
        renderPortalData(result.data);
        loadWellness();
        if (document.getElementById('portalSupportForm')) {
          loadPortalSupport();
        }
        loginView.style.display = 'none';
        dashView.style.display = 'block';
      } else {
        if (typeof resetPortalSessionState === 'function') resetPortalSessionState();
        dashView.style.display = 'none';
        loginView.style.display = 'block';
        continueMembershipHandoff(result.outcome === 'signed_out' ? 'auto' : 'manual');
      }
    })
    .catch(function () {
      if (typeof portalSessionGeneration === 'number' && checkGen && checkGen !== portalSessionGeneration) return;
      if (typeof resetPortalSessionState === 'function') resetPortalSessionState();
      dashView.style.display = 'none';
      loginView.style.display = 'block';
      continueMembershipHandoff('manual');
    });
}

function continueMembershipHandoff(mode) {
  const email = takePortalHandoff();
  const input = document.getElementById('loginEmail');
  if (!email || !input) return;
  input.value = email;
  const welcome = document.getElementById('membershipWelcome');
  if (welcome) {
    welcome.textContent = mode === 'auto'
      ? 'Welcome to the Caregiver Sanctuary! Your membership request is saved. We’re requesting a secure sign-in link for the email below; its status appears under the button.'
      : 'Welcome to the Caregiver Sanctuary! Your membership request is saved. We couldn’t check your sign-in just now, so select “Send me a sign-in link” when you’re ready.';
    welcome.hidden = false;
  }
  if (mode === 'auto') submitPortalLogin();
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
  statusDiv.textContent = 'Requesting sign-in link...';
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
          // dev_link is only returned in demo mode, but it still lands in an href.
          // Accept a same-origin URL only, so a 'javascript:' or off-site value cannot
          // be rendered as a clickable button.
          let devHref = null;
          try {
            const u = new URL(data.dev_link, window.location.origin);
            if (u.origin === window.location.origin) devHref = u.pathname + u.search;
          } catch (err) {
            devHref = null;
          }
          statusDiv.textContent = 'Success! Your sign-in link: ';
          if (devHref) {
            const a = document.createElement('a');
            a.href = devHref;
            a.className = 'btn btn-plum btn-sm mt-8';
            a.style.display = 'inline-block';
            a.style.textDecoration = 'none';
            a.textContent = 'Click here to sign in';
            statusDiv.appendChild(document.createElement('br'));
            statusDiv.appendChild(a);
          }
        } else {
          statusDiv.textContent = 'If this address is registered and delivery is available, check your inbox for a secure sign-in link. If no link arrives, contact Legacy.';
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
      } else if (err.message === 'signin_unavailable') {
        statusDiv.textContent = 'Sign-in is temporarily unavailable. Please contact Legacy or try again later.';
      } else {
        statusDiv.textContent = "We couldn't request a sign-in link just now. Please try again later.";
      }
    })
    .finally(function () {
      if (btn) btn.disabled = false;
    });
}

function portalLogout() {
  const btn = document.getElementById('portalLogoutBtn');
  const logoutStatus = document.getElementById('portalLogoutStatus');
  if (btn && btn.disabled) return; // pending or uncertain: do not repeat the POST
  if (btn) btn.disabled = true;
  if (logoutStatus) {
    logoutStatus.style.display = 'block';
    logoutStatus.textContent = 'Signing out...';
  }

  return fetch('/api/portal/logout', { method: 'POST' })
    .then(function (res) {
      if (res.status !== 200 || res.redirected) throw new Error('logout_unconfirmed');
      return res.json();
    })
    .then(function (data) {
      if (!data || data.ok !== true) throw new Error('logout_unconfirmed');
      if (typeof resetPortalSessionState === 'function') resetPortalSessionState();
      const loginView = document.getElementById('loginView');
      const dashView = document.getElementById('dashView');
      const statusDiv = document.getElementById('loginStatus');
      const emailInput = document.getElementById('loginEmail');

      if (statusDiv) statusDiv.style.display = 'none';
      if (emailInput) emailInput.value = '';

      if (dashView) dashView.style.display = 'none';
      if (loginView) loginView.style.display = 'block';
      if (logoutStatus) logoutStatus.style.display = 'none';
      if (btn) btn.disabled = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return true;
    })
    .catch(function () {
      // A failed acknowledgement is not proof that the session cookie was cleared.
      // Keep the current view and button on HOLD; no automatic or duplicate retry.
      if (logoutStatus) {
        logoutStatus.style.display = 'block';
        logoutStatus.textContent = 'Sign-out could not be confirmed. Close this tab and contact Legacy before trying again.';
      }
      return false;
    });
}

function renderPortalData(data) {
  const safeData = data || {};
  const profile = safeData.profile || {};
  const nextCaregiverKey = portalProfileIdentityKey(profile);
  const nextQaSamples = Boolean(safeData.qa_samples === true);
  const identityChanged = !nextCaregiverKey ||
    nextCaregiverKey !== portalActiveCaregiverKey ||
    nextQaSamples !== portalQaSamplesActive ||
    (portalSupportCacheCaregiverKey && portalSupportCacheCaregiverKey !== nextCaregiverKey);
  if (identityChanged) {
    portalSessionGeneration += 1;
    portalEventsFilterState = 'all';
    portalSupportRealRequests = [];
    portalSupportCacheCaregiverKey = nextCaregiverKey;
    portalSupportLoadedOnce = false;
    portalSupportHistoryUnavailable = false;
    portalSupportFilterState = 'all';
    if (typeof portalSupportPendingRequest !== 'undefined') {
      portalSupportPendingRequest = null;
    }
    if (typeof portalSupportProfileContact !== 'undefined') {
      portalSupportProfileContact = { email: '', phone: '' };
    }
    const eventsFilter = document.getElementById('portalEventsFilter');
    if (eventsFilter) eventsFilter.value = 'all';
    const supportFilter = document.getElementById('portalSupportFilter');
    if (supportFilter) supportFilter.value = 'all';
    const rowsEl = document.getElementById('portalSupportHistoryRows');
    if (rowsEl && !nextQaSamples) {
      rowsEl.textContent = 'Your support requests are not available right now.';
    }
    portalHighlightState.wellnessDue = false;
  }
  portalActiveCaregiverKey = nextCaregiverKey;
  portalQaSamplesActive = nextQaSamples;
  portalRealEvents = Array.isArray(safeData.events) ? safeData.events.slice() : [];
  const welcome = document.getElementById('portalWelcome');
  if (welcome) {
    if (portalQaSamplesActive) {
      const first = typeof profile.first_name === 'string' ? profile.first_name.trim() : '';
      welcome.textContent = first ? 'Welcome to Your Sanctuary, ' + first + '!' : 'Welcome to Your Sanctuary!';
    } else {
      welcome.textContent = 'Welcome back, ' + (profile.first_name || 'Member');
    }
  }

  // My Profile & Intake: read-only account details (updates/intake are not built yet).
  const setText = function (id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value ? String(value) : '—';
  };
  setText('portalProfileName', [profile.first_name, profile.last_name].filter(Boolean).join(' '));
  setText('portalProfileEmail', profile.email);
  setText('portalProfilePhone', profile.phone);

  // Membership status
  const memberStatus = document.getElementById('portalMembershipStatus');
  if (memberStatus) {
    if (profile.sanctuary_member === 1) {
      memberStatus.innerHTML = '<span class="badge badge-green">Sanctuary member</span>';
    } else if (portalQaSamplesActive) {
      memberStatus.innerHTML = '<span class="badge badge-gray">Not yet a member</span>';
    } else {
      memberStatus.innerHTML = '<span class="badge badge-gray">Non-member</span>';
    }
  }
  const profileMemberStatus = document.getElementById('portalProfileMembershipStatus');
  if (profileMemberStatus) {
    if (profile.sanctuary_member === 1) {
      profileMemberStatus.innerHTML = '<span class="badge badge-green">Sanctuary member</span>';
    } else {
      profileMemberStatus.innerHTML = '<span class="badge badge-gray">Not yet a member</span>';
    }
  }

  // Grant status (populated in both #332 standalone card and #333 Sanctuary Updates & Perks card)
  const ga = safeData.grants && safeData.grants.length > 0 ? safeData.grants[0] : null;
  ['portalGrantStatus', 'portalQaGrantStatus'].forEach(function (statusId) {
    const grantStatus = document.getElementById(statusId);
    if (!grantStatus) return;
    if (ga) {
      let badgeClass = 'badge-gray';
      if (ga.status === 'submitted' || ga.status === 'in_review') badgeClass = 'badge-amber';
      else if (ga.status === 'awarded' || ga.status === 'course_complete') badgeClass = 'badge-green';

      // badgeClass is chosen from a fixed set above; ga.status still goes in as text.
      grantStatus.textContent = '';
      const statusBadge = document.createElement('span');
      statusBadge.className = 'badge ' + badgeClass;
      statusBadge.textContent = ga.status === 'course_complete' ? 'Course complete' : String(ga.status || '').replace('_', ' ');
      grantStatus.appendChild(statusBadge);
    } else {
      grantStatus.innerHTML = '<span class="badge badge-gray">No application</span>';
    }
  });
  const grantReqText = ga ? (ga.requested_for || 'Wellness grant') : '—';
  const grantAwardText = ga
    ? (ga.amount ? 'Awarded: ' + ga.amount + ' (' + (ga.care_package || 'No package') + ')' : 'Personalized on approval')
    : '—';
  ['portalGrantRequestedFor', 'portalQaGrantRequestedFor'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.textContent = grantReqText;
  });
  ['portalGrantAward', 'portalQaGrantAward'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.textContent = grantAwardText;
  });

  syncPortalQaSampleChrome();
  filterPortalEvents();

  if (typeof filterPortalSupport === 'function') {
    filterPortalSupport();
  }

  // Memory socials count and details (uses real account events only, populated in both #332 card and #333 My Events card)
  const socials = (safeData.events || []).filter(function (e) { return e.type === 'memory_social'; });
  const attended = socials.filter(function (e) { return e.registration_status === 'attended'; });
  const now = new Date();
  const dated = socials.map(function (event) {
    return { event: event, time: publicEventTime(event.starts_at, now, 'America/Chicago') };
  }).filter(function (entry) { return entry.time; });

  const socialsCountText = attended.length + ' socials';
  const last = dated.filter(function (entry) { return entry.event.registration_status === 'attended'; })
    .sort(function (a, b) { return b.time.instant - a.time.instant; })[0];
  const socialsLastText = last ? last.event.starts_at.slice(0, 10) : '—';
  const next = dated.filter(function (entry) {
    return entry.event.registration_status === 'registered' && entry.time.future;
  }).sort(function (a, b) { return a.time.instant - b.time.instant; })[0];
  const socialsNextText = next ? next.event.title + ' · ' + next.event.starts_at.slice(0, 10) : '—';

  ['portalSocialsCount', 'portalQaSocialsCount'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.textContent = socialsCountText;
  });
  ['portalSocialsLastVisit', 'portalQaSocialsLastVisit'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.textContent = socialsLastText;
  });
  ['portalSocialsNext', 'portalQaSocialsNext'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.textContent = socialsNextText;
  });
}

var portalSessionGeneration = 0;
var portalActiveCaregiverKey = '';
var portalQaSamplesActive = false;
var portalRealEvents = [];
var portalEventsFilterState = 'all';
var portalSupportRealRequests = [];
var portalSupportCacheCaregiverKey = '';
var portalSupportLoadedOnce = false;
var portalSupportHistoryUnavailable = false;
var portalSupportFilterState = 'all';

function bumpPortalSessionGeneration() {
  portalSessionGeneration += 1;
  return portalSessionGeneration;
}

function portalProfileIdentityKey(profile) {
  if (!profile || typeof profile !== 'object') return '';
  const id = typeof profile.id === 'string' ? profile.id.trim() : '';
  const email = typeof profile.email === 'string' ? profile.email.trim().toLowerCase() : '';
  const first = typeof profile.first_name === 'string' ? profile.first_name.trim() : '';
  const last = typeof profile.last_name === 'string' ? profile.last_name.trim() : '';
  if (id || email) return id + '|' + email;
  if (first || last) return 'name:' + first + '|' + last;
  return '';
}

function resetPortalSessionState() {
  portalSessionGeneration += 1;
  portalActiveCaregiverKey = '';
  portalQaSamplesActive = false;
  portalRealEvents = [];
  portalEventsFilterState = 'all';
  portalSupportRealRequests = [];
  portalSupportCacheCaregiverKey = '';
  portalSupportLoadedOnce = false;
  portalSupportHistoryUnavailable = false;
  portalSupportFilterState = 'all';
  if (typeof portalSupportPendingRequest !== 'undefined') {
    portalSupportPendingRequest = null;
  }
  if (typeof portalSupportProfileContact !== 'undefined') {
    portalSupportProfileContact = { email: '', phone: '' };
  }
  const welcome = document.getElementById('portalWelcome');
  if (welcome) welcome.textContent = 'Welcome back';
  ['portalProfileName', 'portalProfileEmail', 'portalProfilePhone'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });
  const memberStatus = document.getElementById('portalMembershipStatus');
  if (memberStatus) memberStatus.innerHTML = '<span class="badge badge-green">Sanctuary member</span>';
  const profileMemberStatus = document.getElementById('portalProfileMembershipStatus');
  if (profileMemberStatus) profileMemberStatus.innerHTML = '<span class="badge badge-gray">—</span>';
  const eventsFilter = document.getElementById('portalEventsFilter');
  if (eventsFilter) eventsFilter.value = 'all';
  const supportFilter = document.getElementById('portalSupportFilter');
  if (supportFilter) supportFilter.value = 'all';
  syncPortalQaSampleChrome();
  const eventsList = document.getElementById('portalEventsList');
  if (eventsList) {
    eventsList.innerHTML = '<p class="small muted m-0">No registered events yet.</p>';
  }
  const rowsEl = document.getElementById('portalSupportHistoryRows');
  if (rowsEl) {
    rowsEl.textContent = 'Your support requests are not available right now.';
  }
  ['portalGrantStatus', 'portalQaGrantStatus'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<span class="badge badge-gray">No application</span>';
  });
  ['portalGrantRequestedFor', 'portalQaGrantRequestedFor', 'portalGrantAward', 'portalQaGrantAward', 'portalSocialsLastVisit', 'portalQaSocialsLastVisit', 'portalSocialsNext', 'portalQaSocialsNext'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });
  ['portalSocialsCount', 'portalQaSocialsCount'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.textContent = '0 socials';
  });
  portalHighlightState.nextEvent = null;
  portalHighlightState.nextSampleEvent = null;
  portalHighlightState.sampleSupportSummary = null;
  portalHighlightState.wellnessDue = false;
  renderPortalHighlights();
}

function portalTextNode(text) {
  return typeof document !== 'undefined' && typeof document.createTextNode === 'function'
    ? document.createTextNode(text)
    : { textContent: String(text) };
}

function portalQaSampleEvents() {
  if (!portalQaSamplesActive) return [];
  return [
    {
      id: 'qa-sample-event-social-upcoming',
      title: '[SAMPLE] Thursday Afternoon Memory Social',
      type: 'memory_social',
      starts_at: portalSampleDate(3, '14:00'),
      location: 'Sample Community Room (QA Illustration)',
      registration_status: 'registered',
      is_sample: true,
      sample_badge: 'SAMPLE / TEST',
      sample_note: 'Fictional sample registration — read-only; does not reserve a seat, send notifications or create a payment.'
    },
    {
      id: 'qa-sample-event-group-upcoming',
      title: '[SAMPLE] Virtual Caregiver Support Group',
      type: 'support_group',
      starts_at: portalSampleDate(6, '17:00'),
      location: 'Online (QA Illustration)',
      registration_status: 'registered',
      is_sample: true,
      sample_badge: 'SAMPLE / TEST',
      sample_note: 'Fictional sample registration — read-only; does not reserve a seat, send notifications or create a payment.'
    },
    {
      id: 'qa-sample-event-wellness-upcoming',
      title: '[SAMPLE] Restorative Breath & Caregiver Renewal',
      type: 'wellness',
      starts_at: portalSampleDate(10, '10:00'),
      location: 'Sanctuary Studio (QA Illustration)',
      registration_status: 'registered',
      is_sample: true,
      sample_badge: 'SAMPLE / TEST',
      sample_note: 'Fictional sample registration — read-only; does not reserve a seat, send notifications or create a payment.'
    },
    {
      id: 'qa-sample-event-workshop-past',
      title: '[SAMPLE] Family Dementia Education Workshop',
      type: 'caregiver_event',
      starts_at: portalSampleDate(-9, '18:00'),
      location: 'Milwaukee Community Center (QA Illustration)',
      registration_status: 'attended',
      is_sample: true,
      sample_badge: 'SAMPLE / TEST',
      sample_note: 'Fictional past attendance entry — read-only; not part of your actual attendance history.'
    },
    {
      id: 'qa-sample-event-social-past',
      title: '[SAMPLE] Autumn Gathering Memory Social',
      type: 'memory_social',
      starts_at: portalSampleDate(-21, '14:00'),
      location: 'Sample Community Room (QA Illustration)',
      registration_status: 'attended',
      is_sample: true,
      sample_badge: 'SAMPLE / TEST',
      sample_note: 'Fictional past attendance entry — read-only; not part of your actual attendance history.'
    }
  ];
}

function portalQaSampleSupportRequests() {
  if (!portalQaSamplesActive) return [];
  return [
    {
      request_id: 'qa-sample-support-in-progress',
      support_type: 'respite_services',
      support_type_label: '[SAMPLE] Respite Services',
      status: 'in_progress',
      status_label: 'In Progress',
      urgency: 'next_few_days',
      urgency_label: 'Next few days',
      contact_preference: 'phone_call',
      contact_preference_label: 'Phone Call',
      submitted_at: portalSampleDate(-2, '10:15'),
      last_status_updated_at: portalSampleDate(-1, '14:30'),
      is_sample: true,
      sample_badge: 'SAMPLE / TEST',
      sample_note: 'Fictional sample support request — read-only; creates no Staff queue task, clinical history, notification or payment.'
    },
    {
      request_id: 'qa-sample-support-received',
      support_type: 'caregiver_support_guidance',
      support_type_label: '[SAMPLE] Caregiver Support & Guidance',
      status: 'received',
      status_label: 'Received',
      urgency: 'general_inquiry',
      urgency_label: 'General inquiry',
      contact_preference: 'email',
      contact_preference_label: 'Email',
      submitted_at: portalSampleDate(0, '09:00'),
      last_status_updated_at: portalSampleDate(0, '09:00'),
      is_sample: true,
      sample_badge: 'SAMPLE / TEST',
      sample_note: 'Fictional sample support request — read-only; creates no Staff queue task, clinical history, notification or payment.'
    },
    {
      request_id: 'qa-sample-support-completed',
      support_type: 'community_resources_referrals',
      support_type_label: '[SAMPLE] Community Resources & Referrals',
      status: 'completed',
      status_label: 'Completed',
      urgency: 'general_inquiry',
      urgency_label: 'General inquiry',
      contact_preference: 'email',
      contact_preference_label: 'Email',
      submitted_at: portalSampleDate(-14, '11:20'),
      last_status_updated_at: portalSampleDate(-10, '16:05'),
      is_sample: true,
      sample_badge: 'SAMPLE / TEST',
      sample_note: 'Fictional sample support request — read-only; creates no Staff queue task, clinical history, notification or payment.'
    }
  ];
}

function syncPortalSelectSampleOptions(selectEl, realLabel) {
  if (!selectEl) return;
  const prevValue = typeof selectEl.value === 'string' ? selectEl.value : '';
  if (typeof selectEl.querySelectorAll === 'function') {
    Array.from(selectEl.querySelectorAll('option[value="real"], option[value="sample"]')).forEach(function (opt) {
      if (typeof opt.remove === 'function') opt.remove();
      else if (opt.parentNode && typeof opt.parentNode.removeChild === 'function') opt.parentNode.removeChild(opt);
    });
  } else if (Array.isArray(selectEl.children)) {
    selectEl.children = selectEl.children.filter(function (opt) {
      const val = opt && (opt.value || (typeof opt.getAttribute === 'function' && opt.getAttribute('value')));
      return val !== 'real' && val !== 'sample';
    });
  }
  if (portalQaSamplesActive) {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function' && typeof selectEl.appendChild === 'function') {
      const realOpt = document.createElement('option');
      realOpt.value = 'real';
      if (typeof realOpt.setAttribute === 'function') realOpt.setAttribute('value', 'real');
      realOpt.textContent = realLabel;
      const sampleOpt = document.createElement('option');
      sampleOpt.value = 'sample';
      if (typeof sampleOpt.setAttribute === 'function') sampleOpt.setAttribute('value', 'sample');
      sampleOpt.textContent = 'Sample / test entries only';
      selectEl.appendChild(realOpt);
      selectEl.appendChild(sampleOpt);
    }
    if (prevValue === 'real' || prevValue === 'sample') {
      selectEl.value = prevValue;
    }
  } else if (prevValue === 'real' || prevValue === 'sample' || selectEl.value === 'real' || selectEl.value === 'sample') {
    selectEl.value = 'all';
  }
}

function syncPortalQaSampleChrome() {
  ['portalWelcomeSub', 'portalQaSampleBanner', 'portalProfileCard', 'portalProfileSampleNote', 'portalSupportCard', 'portalEventsFilterRow', 'portalEventsSocialsSummary', 'portalResourcesSampleNote', 'portalResourcesComingSoon', 'portalUpdatesCard', 'portalUpdatesSampleNote'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.hidden = !portalQaSamplesActive;
  });
  ['portalWellnessSample', 'portalGrantCard', 'portalSocialsCard'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.hidden = Boolean(portalQaSamplesActive);
  });
  const preview = document.getElementById('portalWellnessSample');
  if (portalQaSamplesActive && preview) {
    preview.open = false;
  }
  const accountSummary = document.getElementById('portalAccountSummary');
  if (accountSummary) {
    if (accountSummary.classList && typeof accountSummary.classList.toggle === 'function') {
      accountSummary.classList.toggle('portal-card-grid', Boolean(portalQaSamplesActive));
    }
    accountSummary.hidden = Boolean(!portalQaSamplesActive && preview && preview.open);
  }
  ['portalEventsCard', 'portalResourcesCard', 'portalWellnessTile'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el && el.classList && typeof el.classList.toggle === 'function') {
      el.classList.toggle('portal-card', Boolean(portalQaSamplesActive));
    }
  });
  const setCardHeading = function (id, iconText, labelText) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = '';
    if (portalQaSamplesActive && typeof document !== 'undefined' && typeof document.createElement === 'function' && typeof el.appendChild === 'function') {
      const icon = document.createElement('span');
      icon.className = 'portal-card-icon';
      if (typeof icon.setAttribute === 'function') icon.setAttribute('aria-hidden', 'true');
      icon.textContent = iconText;
      el.appendChild(icon);
      el.appendChild(portalTextNode(' ' + labelText));
    } else {
      el.textContent = iconText + ' ' + labelText;
    }
  };
  setCardHeading('portalEventsHeading', '📅', 'My Events');
  const eventsIntro = document.getElementById('portalEventsIntro');
  if (eventsIntro) {
    eventsIntro.textContent = portalQaSamplesActive
      ? 'Your upcoming and past registrations. Filter by timeframe, type or real vs. sample below.'
      : 'Your registrations are listed here. Browse all events opens the public calendar.';
  }
  setCardHeading('portalResourcesHeading', '📚', portalQaSamplesActive ? 'My Resources' : 'Resource library');
  const resourcesIntro = document.getElementById('portalResourcesIntro');
  if (resourcesIntro) {
    resourcesIntro.textContent = portalQaSamplesActive
      ? 'Shared guides, tools and trusted local help for caregivers.'
      : 'Shared guides, tools and trusted local help for caregivers. This library is public, not a personalized saved list.';
  }
  setCardHeading('portalWellnessHeading', '💛', 'My Wellness');
  syncPortalSelectSampleOptions(document.getElementById('portalEventsFilter'), 'My real registrations only');
  syncPortalSelectSampleOptions(document.getElementById('portalSupportFilter'), 'My real requests only');
  const canShowSupportHistory = Boolean(
    portalQaSamplesActive ||
    document.getElementById('portalSupportForm') ||
    portalSupportLoadedOnce ||
    portalSupportHistoryUnavailable
  );
  const supportHistory = document.getElementById('portalSupportHistory');
  if (supportHistory) {
    supportHistory.hidden = !canShowSupportHistory;
    if (portalQaSamplesActive) {
      supportHistory.open = true;
    } else if (!canShowSupportHistory) {
      supportHistory.open = false;
    }
  }
  const supportFilterRow = document.getElementById('portalSupportFilterRow');
  if (supportFilterRow) {
    supportFilterRow.hidden = !canShowSupportHistory;
  }
  const wellnessHistory = document.getElementById('portalWellnessHistory');
  if (wellnessHistory) {
    wellnessHistory.open = Boolean(portalQaSamplesActive);
  }
}

function filterPortalEvents(filterValue) {
  const filterSelect = document.getElementById('portalEventsFilter');
  let activeFilter = typeof filterValue === 'string' && filterValue
    ? filterValue
    : (filterSelect && typeof filterSelect.value === 'string' && filterSelect.value ? filterSelect.value : (portalEventsFilterState || 'all'));
  if (!portalQaSamplesActive && (activeFilter === 'real' || activeFilter === 'sample')) {
    activeFilter = 'all';
  }
  portalEventsFilterState = activeFilter;
  if (filterSelect && filterSelect.value !== activeFilter) {
    filterSelect.value = activeFilter;
  }

  const eventsList = document.getElementById('portalEventsList');
  if (!portalQaSamplesActive) {
    if (eventsList) {
      eventsList.innerHTML = '';
      if (portalRealEvents && portalRealEvents.length > 0) {
        portalRealEvents.forEach(function (e) { eventsList.appendChild(portalEventItem(e)); });
      } else {
        eventsList.innerHTML = '<p class="small muted m-0">No registered events yet.</p>';
      }
    }
    portalHighlightState.nextEvent = null;
    portalHighlightState.nextSampleEvent = null;
    portalHighlightState.sampleSupportSummary = null;
    renderPortalHighlights();
    return { upcoming: [], past: [] };
  }

  const nowDate = new Date();
  const realTimed = (portalRealEvents || []).map(function (e) {
    return { event: e, time: publicEventTime(e.starts_at, nowDate, 'America/Chicago') };
  });
  const sampleTimed = portalQaSampleEvents().map(function (e) {
    return { event: e, time: publicEventTime(e.starts_at, nowDate, 'America/Chicago') };
  });
  const combined = realTimed.concat(sampleTimed);

  const filtered = combined.filter(function (entry) {
    const ev = entry.event;
    const isFuture = Boolean(entry.time && entry.time.future);
    if (activeFilter === 'upcoming') return isFuture;
    if (activeFilter === 'past') return !isFuture;
    if (activeFilter === 'real') return !ev.is_sample;
    if (activeFilter === 'sample') return Boolean(ev.is_sample);
    if (activeFilter === 'memory_social' || activeFilter === 'support_group' || activeFilter === 'caregiver_event' || activeFilter === 'wellness') {
      return ev.type === activeFilter;
    }
    return true;
  });

  const upcoming = filtered.filter(function (x) { return x.time && x.time.future; })
    .sort(function (a, b) { return a.time.instant - b.time.instant; });
  const past = filtered.filter(function (x) { return !(x.time && x.time.future); })
    .sort(function (a, b) { return (b.time ? b.time.instant : -Infinity) - (a.time ? a.time.instant : -Infinity); });

  if (eventsList) {
    eventsList.innerHTML = '';
    if (filtered.length === 0) {
      eventsList.innerHTML = (activeFilter === 'all' || (activeFilter === 'real' && realTimed.length === 0))
        ? '<p class="small muted m-0">No registered events yet.</p>'
        : '<p class="small muted m-0">No events match this filter.</p>';
    } else {
      [['Upcoming', upcoming], ['Past', past]].forEach(function (group) {
        if (!group[1].length) return;
        const section = document.createElement('div');
        section.className = 'portal-events-group';
        const heading = document.createElement('h5');
        heading.textContent = group[0];
        section.appendChild(heading);
        group[1].forEach(function (entry) { section.appendChild(portalEventItem(entry.event)); });
        eventsList.appendChild(section);
      });
    }
  }

  const realUpcoming = realTimed.filter(function (x) { return x.time && x.time.future; })
    .sort(function (a, b) { return a.time.instant - b.time.instant; });
  const nextRegistered = realUpcoming.find(function (x) { return x.event.registration_status === 'registered'; });
  portalHighlightState.nextEvent = nextRegistered ? nextRegistered.event : null;

  const sampleUpcoming = sampleTimed.filter(function (x) { return x.time && x.time.future; })
    .sort(function (a, b) { return a.time.instant - b.time.instant; });
  const nextSampleRegistered = (portalQaSamplesActive && activeFilter !== 'real')
    ? sampleUpcoming.find(function (x) { return x.event.registration_status === 'registered'; })
    : null;
  portalHighlightState.nextSampleEvent = nextSampleRegistered ? nextSampleRegistered.event : null;
  portalHighlightState.sampleSupportSummary = (portalQaSamplesActive && activeFilter !== 'real' && portalSupportFilterState !== 'real')
    ? '[SAMPLE / TEST] Sample support follow-up (In Progress): [SAMPLE] Respite Services'
    : null;
  renderPortalHighlights();

  return { upcoming: upcoming.map(function (x) { return x.event; }), past: past.map(function (x) { return x.event; }) };
}

function filterPortalSupport(filterValue) {
  const filterSelect = document.getElementById('portalSupportFilter');
  let activeFilter = typeof filterValue === 'string' && filterValue
    ? filterValue
    : (filterSelect && typeof filterSelect.value === 'string' && filterSelect.value ? filterSelect.value : (portalSupportFilterState || 'all'));
  if (!portalQaSamplesActive && (activeFilter === 'real' || activeFilter === 'sample')) {
    activeFilter = 'all';
  }
  portalSupportFilterState = activeFilter;
  if (filterSelect && filterSelect.value !== activeFilter) {
    filterSelect.value = activeFilter;
  }

  const rowsEl = document.getElementById('portalSupportHistoryRows');
  if (portalSupportCacheCaregiverKey && portalSupportCacheCaregiverKey !== portalActiveCaregiverKey) {
    portalSupportRealRequests = [];
    portalSupportCacheCaregiverKey = portalActiveCaregiverKey;
  }
  const realList = Array.isArray(portalSupportRealRequests) ? portalSupportRealRequests : [];
  const sampleList = portalQaSampleSupportRequests();
  const combined = realList.concat(sampleList);

  const filtered = combined.filter(function (req) {
    if (!req) return false;
    if (activeFilter === 'real') return !req.is_sample;
    if (activeFilter === 'sample') return Boolean(req.is_sample);
    if (activeFilter === 'received' || activeFilter === 'in_progress' || activeFilter === 'completed') {
      return req.status === activeFilter;
    }
    return true;
  });

  if (rowsEl) {
    let emptyText;
    if ((portalSupportHistoryUnavailable || !portalSupportLoadedOnce) && (!portalQaSamplesActive || activeFilter === 'real')) {
      emptyText = 'Your support requests are not available right now.';
    } else if (activeFilter === 'all' || (activeFilter === 'real' && realList.length === 0)) {
      emptyText = 'No support requests yet.';
    } else {
      emptyText = 'No support requests match this filter.';
    }
    renderPortalSupportEntryList(rowsEl, filtered, emptyText);
  }

  portalHighlightState.sampleSupportSummary = (portalQaSamplesActive && portalEventsFilterState !== 'real' && activeFilter !== 'real')
    ? '[SAMPLE / TEST] Sample support follow-up (In Progress): [SAMPLE] Respite Services'
    : null;
  renderPortalHighlights();

  return filtered;
}

function renderPortalSupportEntryList(container, requests, emptyText) {
  if (!container) return;
  container.textContent = '';
  if (!Array.isArray(requests) || requests.length === 0) {
    container.textContent = emptyText;
    return;
  }
  const list = document.createElement('ol');
  requests.forEach(function (req) {
    const li = document.createElement('li');
    if (req && req.is_sample) {
      li.className = 'portal-sample-item';
      li.setAttribute('data-portal-sample-item', 'support');
      li.setAttribute('data-sample-status', String(req.status || ''));
    }
    const title = document.createElement('strong');
    title.textContent = String(req.support_type_label || req.support_type || 'Support request');
    const badge = document.createElement('span');
    let badgeClass = 'badge-amber';
    if (req.status === 'completed') badgeClass = 'badge-green';
    else if (req.status === 'in_progress') badgeClass = 'badge-plum';
    badge.className = 'badge ' + badgeClass;
    badge.textContent = String(req.status_label || req.status || 'Received');
    const submitted = String(req.submitted_at || '').slice(0, 10) || '—';
    const updated = String(req.last_status_updated_at || req.submitted_at || '').slice(0, 10) || submitted;
    const meta = document.createElement('span');
    meta.className = 'small muted d-block';
    meta.textContent = 'Submitted ' + submitted + ' · Last status update ' + updated +
      (req.urgency_label ? ' · ' + String(req.urgency_label) : '') +
      (req.contact_preference_label ? ' · Prefer ' + String(req.contact_preference_label) : '');
    li.appendChild(title);
    li.appendChild(portalTextNode(' '));
    li.appendChild(badge);
    if (req && req.is_sample) {
      li.appendChild(portalTextNode(' '));
      const sampleBadge = document.createElement('span');
      sampleBadge.className = 'badge badge-amber portal-sample-badge';
      sampleBadge.textContent = String(req.sample_badge || 'SAMPLE / TEST');
      li.appendChild(sampleBadge);
    }
    li.appendChild(meta);
    if (req && req.is_sample && req.sample_note) {
      const note = document.createElement('span');
      note.className = 'small muted d-block portal-sample-note';
      note.textContent = String(req.sample_note);
      li.appendChild(note);
    }
    list.appendChild(li);
  });
  container.appendChild(list);
}

function initPortalSectionFilters() {
  const eventsFilter = document.getElementById('portalEventsFilter');
  if (eventsFilter && typeof eventsFilter.addEventListener === 'function') {
    eventsFilter.addEventListener('change', function () {
      filterPortalEvents(eventsFilter.value);
    });
  }
  const supportFilter = document.getElementById('portalSupportFilter');
  if (supportFilter && typeof supportFilter.addEventListener === 'function') {
    supportFilter.addEventListener('change', function () {
      filterPortalSupport(supportFilter.value);
    });
  }
}


const PORTAL_EVENT_TYPE_LABELS = { support_group: 'Support Group', memory_social: 'Memory Social', wellness: 'Wellness', caregiver_event: 'Caregiver Event' };

// Built as DOM nodes, not an HTML string: event titles and locations are free text
// authored in the staff console (stored-XSS hardening).
function portalEventItem(e) {
  const item = document.createElement('div');
  item.className = e && e.is_sample ? 'timeline-item portal-sample-item' : 'timeline-item';
  if (e && e.is_sample) {
    item.setAttribute('data-portal-sample-item', 'event');
    item.setAttribute('data-sample-type', String(e.type || ''));
    item.setAttribute('data-sample-status', String(e.registration_status || ''));
  }
  let dotColor = 'var(--ink-soft)';
  if (e.type === 'support_group') dotColor = 'var(--green)';
  else if (e.type === 'memory_social') dotColor = 'var(--amber)';
  else if (e.type === 'wellness') dotColor = 'var(--plum)';
  const dot = document.createElement('div');
  dot.className = 'timeline-dot';
  dot.style.background = dotColor;
  const title = document.createElement('strong');
  title.textContent = e.title || 'Event';
  const badge = document.createElement('span');
  badge.className = 'badge badge-green';
  badge.textContent = e.registration_status || '';
  const when = document.createElement('div');
  when.className = 'when';
  const kind = (portalQaSamplesActive && PORTAL_EVENT_TYPE_LABELS[e.type])
    ? PORTAL_EVENT_TYPE_LABELS[e.type] + ' · '
    : '';
  when.textContent = kind + (e.starts_at || '') + ' · ' + (e.location || 'Online');
  const body = document.createElement('div');
  body.appendChild(title);
  body.appendChild(portalTextNode(' '));
  body.appendChild(badge);
  if (e && e.is_sample) {
    body.appendChild(portalTextNode(' '));
    const sampleBadge = document.createElement('span');
    sampleBadge.className = 'badge badge-amber portal-sample-badge';
    sampleBadge.textContent = e.sample_badge || 'SAMPLE / TEST';
    body.appendChild(sampleBadge);
  }
  body.appendChild(when);
  if (e && e.is_sample && e.sample_note) {
    const note = document.createElement('div');
    note.className = 'small muted portal-sample-note';
    note.textContent = String(e.sample_note);
    body.appendChild(note);
  }
  item.appendChild(dot);
  item.appendChild(body);
  return item;
}

// Dashboard highlights: only information connected to this account (next registered
// event, a due wellness check-in), plus labeled QA sample highlights when the
// verified QA caregiver session is active. Nothing is shown when there is nothing to show.
const portalHighlightState = { nextEvent: null, nextSampleEvent: null, sampleSupportSummary: null, wellnessDue: false };

function renderPortalHighlights() {
  const box = document.getElementById('portalHighlights');
  const list = document.getElementById('portalHighlightsList');
  if (!box || !list) return;
  list.textContent = '';
  if (!portalQaSamplesActive) {
    box.hidden = true;
    return;
  }
  const add = function (icon, text) {
    const li = document.createElement('li');
    const mark = document.createElement('span');
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = icon;
    const body = document.createElement('span');
    body.textContent = text;
    li.appendChild(mark);
    li.appendChild(body);
    list.appendChild(li);
  };
  const e = portalHighlightState.nextEvent;
  if (e) add('📅', 'Your next event: ' + (e.title || 'Event') + ' · ' + String(e.starts_at || '').slice(0, 16));
  const se = portalHighlightState.nextSampleEvent;
  if (se) add('📅', '[SAMPLE / TEST] Sample upcoming event: ' + (se.title || 'Event') + ' · ' + String(se.starts_at || '').slice(0, 16));
  if (portalHighlightState.sampleSupportSummary) add('🤝', portalHighlightState.sampleSupportSummary);
  if (portalHighlightState.wellnessDue) add('💛', 'It’s time for a quick wellness check-in. See My Wellness below.');
  box.hidden = list.children.length === 0;
}

function portalSampleDate(daysFromNow, hhmm) {
  const d = new Date(Date.now() + daysFromNow * 86400000);
  return d.toISOString().slice(0, 10) + ' ' + hhmm;
}


/* ---------- Staff console: governed agent chat mock ---------- */
function agentConfirm(btn) {
  const msg = btn.closest('.msg');
  btn.closest('.confirm-row').innerHTML =
    '<span class="chat-confirm-published">✓ Published — logged to the audit trail. Live on the Events page & portal.</span>';
}
function agentCancel(btn) {
  btn.closest('.confirm-row').innerHTML =
    '<span class="chat-confirm-discarded">Draft discarded — nothing changed.</span>';
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
    '<button class="chip-btn chip-confirm" data-action="agent-confirm">Confirm &amp; publish</button>' +
    '<button class="chip-btn chip-cancel" data-action="agent-cancel">Discard</button>' +
    '</div>';

  setTimeout(function () {
    body.appendChild(bot);
    body.scrollTop = body.scrollHeight;
  }, 450);
  body.scrollTop = body.scrollHeight;
}

/* ---------- Events live D1 listing ---------- */
// Staff datetime-local values are Legacy wall time, not the visitor's browser zone.
// Explicit-offset API timestamps represent instants. The page owns the zone default.
function publicEventTime(value, now, timeZone) {
  if (typeof value !== 'string') return null;
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (local) {
    const normalized = local[1] + '-' + local[2] + '-' + local[3] + 'T' + local[4] + ':' + local[5] + ':' + (local[6] || '00');
    const date = new Date(normalized + 'Z');
    if (isNaN(date.getTime()) || date.toISOString().slice(0, 19) !== normalized) return null;
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
    function wallAt(instant) {
      const wall = {};
      parts.formatToParts(new Date(instant)).forEach(function (part) { wall[part.type] = part.value; });
      return wall.year + '-' + wall.month + '-' + wall.day + 'T' + wall.hour + ':' + wall.minute + ':' + wall.second;
    }
    // Resolve a wall value only if it names one real instant. DST gaps and repeated
    // hours are not enough information to offer registration; staff can use an offset.
    let instant = date.getTime();
    for (let attempt = 0; attempt < 3; attempt++) {
      instant += date.getTime() - Date.parse(wallAt(instant) + 'Z');
    }
    if (wallAt(instant) !== normalized) return null;
    if ([-3600000, -1800000, 1800000, 3600000].some(function (shift) { return wallAt(instant + shift) === normalized; })) return null;
    return { display: normalized.replace('T', ' ').slice(0, 16) + ' (' + timeZone + ')', future: instant > now.getTime(), instant: instant };
  }
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const instant = new Date(value);
  if (isNaN(instant.getTime())) return null;
  const datePart = value.slice(0, 10);
  const day = new Date(datePart + 'T00:00:00Z');
  if (isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== datePart) return null;
  return { display: value, future: instant.getTime() > now.getTime(), instant: instant.getTime() };
}

function safeEventRegistrationUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? value : null;
  } catch { return null; }
}

function renderPublicEvents(events, grid, now) {
  if (!Array.isArray(events)) return false;
  const timeZone = grid.dataset.eventTimeZone || 'America/Chicago';
  // A page can show only its own program's events (Drop-In Respite) under its own badge, and
  // keep its planned dates when nothing matching is published yet.
  const titlePrefix = grid.dataset.eventTitlePrefix || '';
  const badgeText = grid.dataset.eventBadge || '';
  const keepWhenEmpty = grid.dataset.keepWhenEmpty !== undefined;
  const cards = [];
  const cardDates = [];
  let unknown = false;
  const labels = { support_group: 'Support Group', memory_social: 'Memory Social', wellness: 'Wellness', caregiver_event: 'Caregiver Event' };
  events.forEach(function (event) {
    if (!event || typeof event.id !== 'string' || !event.id || typeof event.title !== 'string' || !event.title.trim()) { unknown = true; return; }
    if (event.publish_state && event.publish_state !== 'published') return;
    if (titlePrefix && event.title.trim().indexOf(titlePrefix) !== 0) return;
    const start = publicEventTime(event.starts_at, now, timeZone);
    const end = event.ends_at ? publicEventTime(event.ends_at, now, timeZone) : null;
    if (!start || (event.ends_at && !end) || (end && end.instant < start.instant)) { unknown = true; return; }
    if (!(end || start).future) return;
    const count = event.registered_count;
    const capacity = event.capacity;
    if (!Number.isSafeInteger(count) || count < 0 || (capacity !== null && (!Number.isSafeInteger(capacity) || capacity < 1))) { unknown = true; return; }
    const card = document.createElement('div');
    card.className = 'card event-card';
    const body = document.createElement('div');
    body.className = 'flex-1';
    if (typeof event.photo_key === 'string' && /^event-photos\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\.(jpg|png|webp)$/.test(event.photo_key)) {
      const photo = document.createElement('img');
      photo.className = 'event-photo';
      photo.src = '/media/r2/' + event.photo_key;
      photo.alt = typeof event.photo_alt === 'string' && event.photo_alt ? event.photo_alt : 'Photo for ' + event.title;
      photo.loading = 'lazy';
      photo.decoding = 'async';
      body.appendChild(photo);
    }
    const badge = document.createElement('span');
    badge.className = 'badge badge-plum';
    badge.textContent = badgeText || labels[event.type] || 'Event';
    const title = document.createElement('h3');
    title.className = 'fs-19-m-8-0-4';
    title.textContent = event.title;
    const meta = document.createElement('p');
    meta.className = 'event-meta';
    meta.textContent = start.display + (end ? ' – ' + end.display : '') + (typeof event.location === 'string' && event.location ? ' · ' + event.location : ' · Location pending');
    const description = document.createElement('p');
    description.className = 'event-description';
    description.textContent = typeof event.description === 'string' ? event.description : '';
    const row = document.createElement('div');
    row.className = 'flex-center-gap-12';
    const externalUrl = safeEventRegistrationUrl(event.registration_url);
    const hasExternal = event.registration_url != null && event.registration_url !== '';
    const externalOpen = hasExternal && externalUrl && start.future;
    const button = document.createElement(externalOpen ? 'a' : 'button');
    const full = capacity !== null && count >= capacity;
    button.className = (!hasExternal && full) || !start.future || (hasExternal && !externalUrl) ? 'btn btn-outline btn-sm' : 'btn btn-plum btn-sm';
    if (!externalOpen) button.type = 'button';
    button.textContent = !start.future ? 'Registration closed' : hasExternal ? (externalUrl ? 'Register on event site' : 'Registration unavailable') : full ? 'Full' : 'Register';
    button.disabled = !start.future || (hasExternal ? !externalUrl : full);
    if (externalOpen) {
      button.href = externalUrl;
      button.target = '_blank';
      button.rel = 'noopener noreferrer';
    } else if (!button.disabled) {
      button.dataset.action = 'open-register';
      button.dataset.eventId = event.id;
      button.dataset.eventTitle = event.title;
    }
    const note = document.createElement('span');
    note.className = 'small muted';
    note.textContent = hasExternal ? 'Registration is handled by the event organizer.' : count + ' registered' + (capacity !== null ? ' · capacity ' + capacity : '');
    row.appendChild(button);
    row.appendChild(note);
    body.appendChild(badge);
    body.appendChild(title);
    body.appendChild(meta);
    if (description.textContent) body.appendChild(description);
    body.appendChild(row);
    card.appendChild(body);
    cards.push(card);
    cardDates.push(start.display.slice(0, 10));
  });
  if (keepWhenEmpty) return mergePlannedEvents(grid, cards, cardDates, now, timeZone);
  if (!cards.length) {
    if (unknown || keepWhenEmpty) return false;
    const empty = document.createElement('p');
    empty.className = 'small muted';
    empty.textContent = 'No upcoming published events. Please check back for confirmed dates and registration.';
    cards.push(empty);
  }
  grid.replaceChildren.apply(grid, cards);
  return true;
}

// A planned-date card (data-planned-date="YYYY-MM-DD") stays until a published session on
// that date takes its place; other published sessions join in date order, and planned dates
// that have already passed drop out.
function mergePlannedEvents(grid, cards, cardDates, now, timeZone) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const used = [];
  const merged = [];
  Array.prototype.slice.call(grid.children).forEach(function (el) {
    const date = el.dataset && el.dataset.plannedDate;
    if (!date || date < today) return;
    const index = cardDates.indexOf(date);
    if (index >= 0 && used.indexOf(index) < 0) {
      used.push(index);
      merged.push({ date: date, el: cards[index] });
    } else {
      merged.push({ date: date, el: el });
    }
  });
  cards.forEach(function (card, index) {
    if (used.indexOf(index) < 0) merged.push({ date: cardDates[index], el: card });
  });
  merged.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  grid.replaceChildren.apply(grid, merged.map(function (item) { return item.el; }));
  return cards.length > 0;
}

function loadLiveEvents() {
  const grid = document.getElementById('liveEventsGrid');
  const cards = document.querySelectorAll('.event-card');
  if (!grid && !cards.length) return;

  fetch('/api/events')
    .then(function (res) { if (!res.ok) throw new Error('events_unavailable'); return res.json(); })
    .then(function (data) {
      if (!data.ok || !data.events) return;
      if (grid) {
        renderPublicEvents(data.events, grid, new Date());
        return;
      }
      
      data.events.forEach(function (e) {
        const btn = Array.from(document.querySelectorAll('button')).find(function (b) {
          return b.dataset.eventId === e.id || b.getAttribute('data-event-id') === e.id;
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
                btn.removeAttribute('data-action');
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
  initPortalSummaryPreview();
  initPortalSectionFilters();
  if (typeof window !== 'undefined') initUnsubscribePage(window.location, window.history);
  initEmailListForm();
  loadLiveEvents();
  checkPortalSession();
});


/* Photo carousel: progressive enhancement only.
   The track scrolls natively with scroll-snap, so everything here is optional. The
   arrows stay hidden in markup and are revealed only once this runs - a control that
   does nothing is worse than no control. */
(function () {
  document.querySelectorAll('[data-carousel]').forEach(function (root) {
    var track = root.querySelector('[data-carousel-track]');
    var prev = root.querySelector('[data-carousel-prev]');
    var next = root.querySelector('[data-carousel-next]');
    if (!track || !prev || !next) return;

    var item = track.querySelector('.carousel-item');
    if (!item) return;

    function step() {
      var gap = parseFloat(getComputedStyle(track).gap) || 0;
      return item.getBoundingClientRect().width + gap;
    }
    function sync() {
      var max = track.scrollWidth - track.clientWidth - 1;
      prev.disabled = track.scrollLeft <= 0;
      next.disabled = track.scrollLeft >= max;
      var overflows = track.scrollWidth > track.clientWidth + 1;
      prev.hidden = next.hidden = !overflows;
    }
    prev.addEventListener('click', function () { track.scrollBy({ left: -step(), behavior: 'smooth' }); });
    next.addEventListener('click', function () { track.scrollBy({ left: step(), behavior: 'smooth' }); });
    track.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();

    // Distinguish a tap from a drag so dragging the carousel does not navigate.
    var startX = 0;
    var startY = 0;
    var isDown = false;
    var isDragging = false;
    var suppressUntil = 0;
    var DRAG_THRESHOLD = 6;

    function getCoords(e) {
      if (e.touches && e.touches.length) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
      return { x: e.clientX, y: e.clientY };
    }

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      isDown = true;
      isDragging = false;
      var c = getCoords(e);
      startX = c.x;
      startY = c.y;
    }

    function onPointerMove(e) {
      if (!isDown) return;
      var c = getCoords(e);
      var dx = Math.abs(c.x - startX);
      var dy = Math.abs(c.y - startY);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        isDragging = true;
      }
    }

    function onPointerUp() {
      if (isDown && isDragging) {
        suppressUntil = Date.now() + 500;
      }
      isDown = false;
      isDragging = false;
    }

    track.addEventListener('dragstart', function (e) {
      e.preventDefault();
    });

    track.addEventListener('pointerdown', onPointerDown);
    track.addEventListener('pointermove', onPointerMove);
    track.addEventListener('pointerup', onPointerUp);
    track.addEventListener('pointercancel', onPointerUp);

    track.addEventListener('touchstart', onPointerDown, { passive: true });
    track.addEventListener('touchmove', onPointerMove, { passive: true });
    track.addEventListener('touchend', onPointerUp, { passive: true });
    track.addEventListener('touchcancel', onPointerUp, { passive: true });

    track.addEventListener('scroll', function () {
      if (isDown) {
        isDragging = true;
        suppressUntil = Date.now() + 500;
      }
    }, { passive: true });

    track.addEventListener('click', function (e) {
      var link = e.target.closest('.carousel-link');
      if (!link) return;
      if (isDragging || Date.now() < suppressUntil) {
        e.preventDefault();
        e.stopPropagation();
        suppressUntil = 0;
        isDragging = false;
      }
    }, true);
  });
})();

/* Gallery lightbox: progressive enhancement over the plain grid.
   Uses a native <dialog>, so focus trapping, Esc-to-close and the backdrop come
   from the browser instead of hand-rolled listeners. If this never runs, the
   gallery page is still complete - the thumbnails just don't open. */
(function () {
  var dlg = document.getElementById('lightbox');
  var grid = document.querySelectorAll('.gallery-open');
  if (!dlg || !grid.length || typeof dlg.showModal !== 'function') return;

  var img = document.getElementById('lightboxImg');
  var cap = document.getElementById('lightboxCaption');
  var items = Array.prototype.map.call(grid, function (b) {
    return { src: b.dataset.src, alt: b.dataset.alt, caption: b.dataset.caption || '', cell: b.closest('.gallery-cell') };
  });
  function visible() {
    return items.filter(function (it) { return !it.cell || !it.cell.hidden; });
  }
  /* Folder selector: options come from the folders in content/gallery.json, so a new
     folder in the client's Drive becomes a new option with no code change. */
  var filter = document.querySelector('[data-gallery-filter]');
  if (filter) {
    filter.addEventListener('change', function () {
      var want = filter.value;
      items.forEach(function (it) {
        if (it.cell) it.cell.hidden = !!want && it.cell.dataset.folder !== want;
      });
    });
  }
  var at = 0;
  var opener = null;

  function show(i) {
    var list = visible();
    if (!list.length) return;
    at = (i + list.length) % list.length;
    var it = list[at];
    img.src = it.src;
    img.alt = it.alt;
    cap.textContent = it.caption || (at + 1) + ' of ' + list.length;
  }

  Array.prototype.forEach.call(grid, function (btn, i) {
    btn.addEventListener('click', function () {
      opener = btn;          // so focus goes back where it came from
      show(visible().indexOf(items[i]));
      dlg.showModal();
    });
  });

  dlg.querySelector('[data-lb-close]').addEventListener('click', function () { dlg.close(); });
  dlg.querySelector('[data-lb-prev]').addEventListener('click', function () { show(at - 1); });
  dlg.querySelector('[data-lb-next]').addEventListener('click', function () { show(at + 1); });

  dlg.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(at - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); show(at + 1); }
  });

  /* Clicking the dark surround closes; clicking the photo itself must not. */
  dlg.addEventListener('click', function (e) {
    if (e.target === dlg) dlg.close();
  });

  dlg.addEventListener('close', function () {
    img.src = '';
    if (opener) { opener.focus(); opener = null; }
  });
})();

/* Resource links whose destination the client has not supplied yet (link-class stubs):
   nothing happens on click until the URL lands in content/resource-links.json. */
function resourceLinkPending(el) { if (el) el.blur(); }

/* ---------- Event delegation: data-action wiring ---------- */
document.addEventListener('submit', function (e) {
  const form = e.target.closest('form[data-action]');
  if (!form) return;
  const action = form.getAttribute('data-action');
  if (action === 'submit-support') {
    e.preventDefault();
    submitSupport(e);
  } else if (action === 'submit-membership') {
    e.preventDefault();
    submitMembership(e);
  } else if (action === 'submit-grant-apply') {
    e.preventDefault();
    submitGrantApply(e);
  } else if (action === 'submit-coaching-interest') {
    e.preventDefault();
    submitCoachingInterest(e);
  } else if (action === 'submit-support-group-interest') {
    e.preventDefault();
    submitSupportGroupInterest(e);
  } else if (action === 'submit-register') {
    e.preventDefault();
    submitRegister(e);
  } else if (action === 'submit-email-list') {
    e.preventDefault();
    submitEmailList(e);
  } else if (action === 'submit-unsubscribe') {
    e.preventDefault();
    submitUnsubscribe(e);
  }
});

/* ---------- Portal: My Wellness check-in (schema 0012) ---------- */
let wellnessQuestions = [];

async function loadWellness() {
  const reqGen = typeof portalSessionGeneration === 'number' ? portalSessionGeneration : 0;
  const reqKey = typeof portalActiveCaregiverKey === 'string' ? portalActiveCaregiverKey : '';
  const summary = document.getElementById('portalWellnessSummary');
  if (summary) summary.textContent = 'Loading your saved check-ins…';
  drawWellnessTrend(document.getElementById('portalWellnessTrend'), []);
  renderWellnessHistory(document.getElementById('portalWellnessHistoryRows'), [], 'Loading your saved history…');
  try {
    const res = await fetch('/api/portal/wellness', { credentials: 'same-origin' });
    const data = await res.json();
    if ((typeof portalSessionGeneration === 'number' && reqGen !== portalSessionGeneration) ||
        (typeof portalActiveCaregiverKey === 'string' && reqKey !== portalActiveCaregiverKey)) {
      return;
    }
    if (!res.ok || !data.ok) throw new Error('unavailable');
    wellnessQuestions = data.questions || [];
    renderWellness(data);
  } catch (e) {
    if ((typeof portalSessionGeneration === 'number' && reqGen !== portalSessionGeneration) ||
        (typeof portalActiveCaregiverKey === 'string' && reqKey !== portalActiveCaregiverKey)) {
      return;
    }
    if (summary) summary.textContent = 'Your wellness check-ins are not available right now.';
    renderWellnessHistory(document.getElementById('portalWellnessHistoryRows'), [], 'Your saved history is not available right now.');
  }
}

function renderWellness(data) {
  const summary = document.getElementById('portalWellnessSummary');
  const btn = document.getElementById('portalWellnessBtn');
  const history = data.history || [];
  if (summary) {
    if (history.length === 0) {
      summary.textContent = 'A short check-in on how you are doing. Only you and the Legacy team see your answers.';
    } else {
      const last = history[history.length - 1];
      const when = String(last.created_at || '').slice(0, 10);
      summary.textContent = 'Latest: ' + last.score + ' out of 100 (' + when + '). ' +
        (data.due ? 'Your next check-in is ready.' : 'Your next check-in will appear here when ready.');
    }
  }
  if (btn) btn.classList.toggle('d-none', !data.due);
  if (typeof portalHighlightState === 'object' && typeof renderPortalHighlights === 'function') {
    portalHighlightState.wellnessDue = !!data.due;
    renderPortalHighlights();
  }
  const trendHint = document.getElementById('portalWellnessTrendHint');
  if (trendHint) trendHint.textContent = history.length < 2
    ? 'A trend appears after two check-ins.' : 'Scores shown oldest to newest.';
  drawWellnessTrend(document.getElementById('portalWellnessTrend'), history.map(function (h) { return h.score; }));
  renderWellnessHistory(document.getElementById('portalWellnessHistoryRows'), history, 'No saved check-ins yet.');
}

function renderWellnessHistory(container, history, emptyText) {
  if (!container) return;
  container.textContent = '';
  if (!history.length) { container.textContent = emptyText; return; }
  const list = document.createElement('ol');
  history.forEach(function (entry) {
    const row = document.createElement('li');
    row.textContent = String(entry.created_at || '').slice(0, 10) + ' — ' + entry.score + ' out of 100';
    list.appendChild(row);
  });
  container.appendChild(list);
}

function initPortalSummaryPreview() {
  const preview = document.getElementById('portalWellnessSample');
  const actual = document.getElementById('portalAccountSummary');
  if (!preview || !actual) return;
  // Display-only examples: no session, storage, API data or check-in changes.
  const sync = function () { actual.hidden = Boolean(preview.open && !portalQaSamplesActive); };
  preview.open = false;
  sync();
  preview.addEventListener('toggle', sync);
  document.getElementById('portalPreviewReturn')?.addEventListener('click', function () {
    preview.open = false;
    sync();
    document.getElementById('portalPreviewToggle')?.focus();
  });
}

function drawWellnessTrend(container, scores, accessibleLabel) {
  if (!container) return;
  container.textContent = '';
  if (!scores || scores.length < 2) return;
  const ns = 'http://www.w3.org/2000/svg';
  const w = 240, h = 60, pad = 4;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', (accessibleLabel || 'Recent check-in scores, oldest to newest: ') + scores.join(', '));
  const step = (w - pad * 2) / (scores.length - 1);
  const pts = scores.map(function (s, i) {
    return (pad + i * step).toFixed(1) + ',' + (h - pad - (s / 100) * (h - pad * 2)).toFixed(1);
  });
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', pts.join(' '));
  line.setAttribute('class', 'wellness-line');
  svg.appendChild(line);
  container.appendChild(svg);
}

function openWellnessForm() {
  const box = document.getElementById('portalWellnessForm');
  const btn = document.getElementById('portalWellnessBtn');
  if (!box) return;
  box.textContent = '';
  wellnessQuestions.forEach(function (q) {
    const fs = document.createElement('fieldset');
    fs.className = 'wellness-q';
    const lg = document.createElement('legend');
    lg.textContent = q.text;
    fs.appendChild(lg);
    const row = document.createElement('div');
    row.className = 'wellness-scale';
    for (let v = 1; v <= 5; v++) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'wq_' + q.id;
      input.value = String(v);
      label.appendChild(input);
      const span = document.createElement('span');
      span.textContent = String(v);
      label.appendChild(span);
      row.appendChild(label);
    }
    fs.appendChild(row);
    const ends = document.createElement('div');
    ends.className = 'wellness-ends small muted';
    const lo = document.createElement('span');
    lo.textContent = q.low;
    const hi = document.createElement('span');
    hi.textContent = q.high;
    ends.appendChild(lo);
    ends.appendChild(hi);
    fs.appendChild(ends);
    box.appendChild(fs);
  });
  const note = document.createElement('textarea');
  note.id = 'portalWellnessNote';
  note.maxLength = 1000;
  note.rows = 2;
  note.placeholder = 'Anything you want the Legacy team to know? (optional)';
  note.className = 'wellness-note';
  box.appendChild(note);
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'btn btn-plum btn-sm mt-8';
  submit.setAttribute('data-action', 'wellness-submit');
  submit.textContent = 'Save my check-in';
  box.appendChild(submit);
  box.classList.remove('d-none');
  if (btn) btn.classList.add('d-none');
}

async function submitWellness(button) {
  const msg = document.getElementById('portalWellnessMsg');
  const answers = {};
  for (const q of wellnessQuestions) {
    const picked = document.querySelector('input[name="wq_' + q.id + '"]:checked');
    if (!picked) {
      if (msg) msg.textContent = 'Please answer each question.';
      return;
    }
    answers[q.id] = Number(picked.value);
  }
  const noteEl = document.getElementById('portalWellnessNote');
  if (button) button.disabled = true;
  try {
    const res = await fetch('/api/portal/wellness', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: answers, note: noteEl ? noteEl.value : '' })
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data.ok) throw new Error(data.error || 'Could not save your check-in.');
    const box = document.getElementById('portalWellnessForm');
    if (box) {
      box.classList.add('d-none');
      box.textContent = '';
    }
    if (msg) msg.textContent = 'Thank you. Your check-in is saved.';
    loadWellness();
  } catch (e) {
    if (msg) msg.textContent = e.message;
    if (button) button.disabled = false;
  }
}

/* ---------- Portal: My Support requests & history (LP-02 staged increment) ---------- */
let portalSupportPendingRequest = null;
let portalSupportProfileContact = { email: '', phone: '' };

async function loadPortalSupport() {
  const reqGen = typeof portalSessionGeneration === 'number' ? portalSessionGeneration : 0;
  const reqKey = typeof portalActiveCaregiverKey === 'string' ? portalActiveCaregiverKey : '';
  const rowsEl = document.getElementById('portalSupportHistoryRows');
  if (rowsEl) rowsEl.textContent = 'Loading your support requests…';
  try {
    const res = await fetch('/api/portal/support', { credentials: 'same-origin' });
    const data = await res.json();
    if ((typeof portalSessionGeneration === 'number' && reqGen !== portalSessionGeneration) ||
        (typeof portalActiveCaregiverKey === 'string' && reqKey !== portalActiveCaregiverKey)) {
      return { ok: false, stale: true, requests: [], matchedReceipt: null };
    }
    if (!res.ok || !data || !data.ok) throw new Error('unavailable');
    if (data.profile_contact && typeof data.profile_contact === 'object') {
      portalSupportProfileContact = {
        email: String(data.profile_contact.email || ''),
        phone: String(data.profile_contact.phone || '')
      };
    }
    const matchedReceipt = renderPortalSupport(data);
    return {
      ok: true,
      requests: Array.isArray(data.requests) ? data.requests : [],
      matchedReceipt: matchedReceipt
    };
  } catch (e) {
    if ((typeof portalSessionGeneration === 'number' && reqGen !== portalSessionGeneration) ||
        (typeof portalActiveCaregiverKey === 'string' && reqKey !== portalActiveCaregiverKey)) {
      return { ok: false, stale: true, requests: [], matchedReceipt: null };
    }
    if (typeof portalSupportRealRequests !== 'undefined') {
      portalSupportRealRequests = [];
    }
    if (typeof portalSupportCacheCaregiverKey !== 'undefined' && typeof portalActiveCaregiverKey === 'string') {
      portalSupportCacheCaregiverKey = portalActiveCaregiverKey;
    }
    if (typeof portalSupportLoadedOnce !== 'undefined') {
      portalSupportLoadedOnce = false;
    }
    if (typeof portalSupportHistoryUnavailable !== 'undefined') {
      portalSupportHistoryUnavailable = true;
    }
    if (typeof syncPortalQaSampleChrome === 'function') {
      syncPortalQaSampleChrome();
    }
    if (typeof portalQaSamplesActive !== 'undefined' && portalQaSamplesActive && typeof filterPortalSupport === 'function') {
      filterPortalSupport();
    } else {
      renderPortalSupportHistory(rowsEl, [], 'Your support requests are not available right now.');
    }
    return { ok: false, requests: [], matchedReceipt: null };
  }
}

function renderPortalSupport(data) {
  const requests = Array.isArray(data && data.requests) ? data.requests : [];
  if (typeof portalSupportLoadedOnce !== 'undefined') {
    portalSupportLoadedOnce = true;
  }
  if (typeof portalSupportHistoryUnavailable !== 'undefined') {
    portalSupportHistoryUnavailable = false;
  }
  if (typeof portalSupportRealRequests !== 'undefined') {
    portalSupportRealRequests = requests.slice();
    if (typeof portalSupportCacheCaregiverKey !== 'undefined' && typeof portalActiveCaregiverKey === 'string') {
      portalSupportCacheCaregiverKey = portalActiveCaregiverKey;
    }
  }
  if (typeof syncPortalQaSampleChrome === 'function') {
    syncPortalQaSampleChrome();
  }
  const rowsEl = document.getElementById('portalSupportHistoryRows');
  const useDashboardFilter = typeof filterPortalSupport === 'function' && (
    (typeof portalQaSamplesActive !== 'undefined' && portalQaSamplesActive) ||
    (typeof portalSupportFilterState === 'string' && portalSupportFilterState !== 'all')
  );
  if (useDashboardFilter) {
    filterPortalSupport();
  } else {
    renderPortalSupportHistory(rowsEl, requests, 'No support requests yet.');
    if (typeof portalHighlightState === 'object' && typeof renderPortalHighlights === 'function') {
      portalHighlightState.supportCount = requests.length;
      renderPortalHighlights();
    }
  }
  if (portalSupportPendingRequest) {
    const matched = requests.find(function (r) {
      return r && !r.is_sample && r.request_id === portalSupportPendingRequest.requestId;
    }) || null;
    if (matched) {
      const wasUnresolved = Boolean(portalSupportPendingRequest.unresolved);
      const wasConflict = Boolean(portalSupportPendingRequest.conflict);
      portalSupportPendingRequest = null;
      const form = document.getElementById('portalSupportForm');
      if (form) {
        form.reset();
        form.classList.add('d-none');
      }
      const openBtn = document.getElementById('portalSupportBtn');
      if (openBtn) openBtn.classList.remove('d-none');
      const historyDetails = document.getElementById('portalSupportHistory');
      if (historyDetails) historyDetails.open = true;
      if (wasConflict || wasUnresolved) {
        const msg = document.getElementById('portalSupportMsg');
        if (msg) {
          if (wasConflict) {
            msg.textContent = 'Your original support request was already saved and is shown in your history below. If you still need additional changes, you can start a new request.';
          } else {
            msg.textContent = 'Confirmed: your support request (' +
              (matched.support_type_label || 'Support request') + ') was saved (' +
              (matched.status_label || 'Received') + ').';
          }
        }
      }
      return matched;
    }
  }
  return null;
}

function renderPortalSupportHistory(container, requests, emptyText) {
  if (typeof renderPortalSupportEntryList === 'function') {
    renderPortalSupportEntryList(container, requests, emptyText);
    return;
  }
  if (!container) return;
  container.textContent = '';
  if (!Array.isArray(requests) || requests.length === 0) {
    container.textContent = emptyText;
    return;
  }
  const list = document.createElement('ol');
  requests.forEach(function (req) {
    const li = document.createElement('li');
    const isSample = Boolean(req && req.is_sample);
    if (isSample) {
      li.className = 'portal-sample-item';
      li.setAttribute('data-portal-sample-item', 'support');
      li.setAttribute('data-sample-status', String(req.status || ''));
    }
    const title = document.createElement('strong');
    title.textContent = String(req.support_type_label || req.support_type || 'Support request');
    const badge = document.createElement('span');
    let badgeClass = 'badge-amber';
    if (req.status === 'completed') badgeClass = 'badge-green';
    else if (req.status === 'in_progress') badgeClass = 'badge-plum';
    badge.className = 'badge ' + badgeClass;
    badge.textContent = String(req.status_label || req.status || 'Received');
    const submitted = String(req.submitted_at || '').slice(0, 10) || '—';
    const updated = String(req.last_status_updated_at || req.submitted_at || '').slice(0, 10) || submitted;
    const meta = document.createElement('span');
    meta.className = 'small muted d-block';
    meta.textContent = 'Submitted ' + submitted + ' · Last status update ' + updated +
      (req.urgency_label ? ' · ' + String(req.urgency_label) : '') +
      (req.contact_preference_label ? ' · Prefer ' + String(req.contact_preference_label) : '');
    if (isSample) {
      const sampleBadge = document.createElement('span');
      sampleBadge.className = 'portal-sample-badge';
      sampleBadge.textContent = String(req.sample_badge || 'SAMPLE / TEST');
      li.appendChild(sampleBadge);
      li.appendChild(typeof document.createTextNode === 'function' ? document.createTextNode(' ') : { textContent: ' ' });
    }
    li.appendChild(title);
    li.appendChild(typeof document.createTextNode === 'function' ? document.createTextNode(' ') : { textContent: ' ' });
    li.appendChild(badge);
    li.appendChild(meta);
    list.appendChild(li);
  });
  container.appendChild(list);
}

document.addEventListener('click', function (e) {
  const target = e.target.closest('[data-action]');
  if (!target || target.tagName === 'FORM') return;
  const action = target.getAttribute('data-action');
  if (action === 'open-membership') {
    e.preventDefault();
    openMembership();
  } else if (action === 'close-membership') {
    e.preventDefault();
    closeMembership();
  } else if (action === 'open-grant-apply') {
    e.preventDefault();
    openGrantApply();
  } else if (action === 'close-grant-apply') {
    e.preventDefault();
    closeGrantApply();
  } else if (action === 'open-coaching-interest') {
    e.preventDefault();
    openCoachingInterest();
  } else if (action === 'close-coaching-interest') {
    e.preventDefault();
    closeCoachingInterest();
  } else if (action === 'toggle-support-group-sessions') {
    toggleSupportGroupSessions(target);
  } else if (action === 'open-support-group-interest') {
    e.preventDefault();
    openSupportGroupInterest(target);
  } else if (action === 'close-support-group-interest') {
    e.preventDefault();
    closeSupportGroupInterest();
  } else if (action === 'open-register') {
    e.preventDefault();
    const title = target.getAttribute('data-event-title') || '';
    const eventId = target.getAttribute('data-event-id') || '';
    openRegister(title, eventId);
  } else if (action === 'close-register') {
    e.preventDefault();
    closeRegister();
  } else if (action === 'toggle-nav') {
    e.preventDefault();
    const nav = document.querySelector('.main-nav');
    if (window.toggleMainNavigation) window.toggleMainNavigation();
    else if (nav) nav.classList.toggle('open');
  } else if (action === 'demo-resource-link') {
    e.preventDefault();
    resourceLinkPending(target);
  } else if (action === 'demo-grant-status') {
    e.preventDefault();
    alert('Your application status is tracked on your caregiver record. Staff and you see the same journey.');
  } else if (action === 'submit-portal-login') {
    e.preventDefault();
    submitPortalLogin(e);
  } else if (action === 'wellness-open') {
    e.preventDefault();
    openWellnessForm();
  } else if (action === 'wellness-submit') {
    e.preventDefault();
    submitWellness(target);
  } else if (action === 'portal-logout') {
    e.preventDefault();
    portalLogout();
  } else if (action === 'agent-confirm') {
    e.preventDefault();
    agentConfirm(target);
  } else if (action === 'agent-cancel') {
    e.preventDefault();
    agentCancel(target);
  } else if (action === 'agent-send') {
    e.preventDefault();
    agentSend();
  }
});
