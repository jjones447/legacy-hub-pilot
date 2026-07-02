/* Legacy Caregiver Hub — demo interactions (sample data only) */

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
function openRegister(title) {
  const modal = document.getElementById('registerModal');
  document.getElementById('regTitle').textContent = 'Register — ' + title;
  document.getElementById('regSuccess').style.display = 'none';
  document.getElementById('regRouting').style.display = 'none';
  modal.classList.add('open');
}
function closeRegister() {
  document.getElementById('registerModal').classList.remove('open');
}
function submitRegister(e) {
  e.preventDefault();
  document.getElementById('regSuccess').style.display = 'block';
  setTimeout(function () {
    document.getElementById('regRouting').style.display = 'block';
  }, 600);
  return false;
}
document.addEventListener('click', function (e) {
  const overlay = document.getElementById('registerModal');
  if (overlay && e.target === overlay) closeRegister();
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
