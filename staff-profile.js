/* Read-only Profile projections. No cached answers, exports or browser storage. */
(function () {
  'use strict';
  window.createStaffProfileViews = function (detailRoot, summaryRoot, options = {}) {
    const request = options.fetch || window.fetch.bind(window);
    let identityEpoch = 0, identityReady = false, detailEpoch = 0, summaryEpoch = 0, caregiver = null;
    const node = (tag, text) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
    function button(root, label, action) {
      const el = node('button', label); el.type = 'button'; el.className = 'btn btn-outline';
      el.disabled = !identityReady; el.addEventListener('click', action); root.append(el);
    }
    function resetDetail() {
      detailEpoch++; detailRoot.replaceChildren(); detailRoot.hidden = !caregiver;
      if (!caregiver) return;
      detailRoot.append(node('h3', 'Caregiver Profile'), node('p', 'Self-reported answers. Viewing these answers does not change the caregiver account or contact anyone.'));
      button(detailRoot, 'Load saved Profile', () => { void loadDetail(); });
    }
    function resetSummary() {
      summaryEpoch++; summaryRoot.replaceChildren();
      summaryRoot.append(node('p', 'Whole-group Profile counts. Small groups are withheld to reduce disclosure; withheld does not mean zero.'));
      button(summaryRoot, 'Load Profile summary', () => { void loadSummary(); });
    }
    function beginIdentity() {
      identityEpoch++; identityReady = false; resetDetail(); resetSummary(); return identityEpoch;
    }
    function setIdentity(token, me) {
      if (token !== identityEpoch) return;
      identityReady = !!me && me.status === 'active' && ['admin', 'staff'].includes(me.role);
      resetDetail(); resetSummary();
    }
    function selectCaregiver(id) { caregiver = id; resetDetail(); }
    function clearCaregiver() { caregiver = null; resetDetail(); }
    function unavailable(root, status) {
      root.replaceChildren(node('p', status === 404 ? 'No saved Profile is available here.' : 'Profile access is unavailable. Refresh staff access before trying again.'));
    }
    async function read(path) {
      const res = await request(path, { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
      if (res.status !== 200 || res.redirected) return { status: res.status };
      const body = await res.json();
      return body?.ok === true ? { status: 200, body } : { status: 503 };
    }
    async function loadDetail() {
      if (!identityReady || !caregiver) return;
      const id = caregiver, token = ++detailEpoch, actor = identityEpoch;
      detailRoot.replaceChildren(node('p', 'Loading saved Profile…'));
      try {
        const result = await read('/api/staff/caregiver-profile/' + encodeURIComponent(id));
        if (token !== detailEpoch || actor !== identityEpoch || id !== caregiver) return;
        if (result.status !== 200) { unavailable(detailRoot, result.status); return; }
        const { profile, sections } = result.body;
        if (!profile?.fields || !Array.isArray(sections)) throw Error('unavailable');
        detailRoot.replaceChildren(node('h3', 'Saved caregiver Profile'));
        detailRoot.append(node('p', 'Only answers available to your current staff access are shown. These self-reported answers do not replace account contact details.'));
        for (const section of sections) {
          const answers = section.fields.filter(f => Object.hasOwn(profile.fields, f.key));
          if (!answers.length) continue;
          const block = node('section'); block.append(node('h4', section.title)); const list = node('dl');
          for (const field of answers) {
            const value = profile.fields[field.key];
            list.append(node('dt', field.label), node('dd', value === null || value === '' || (Array.isArray(value) && !value.length)
              ? 'Not answered' : Array.isArray(value) ? value.join('; ') : String(value)));
          }
          block.append(list); detailRoot.append(block);
        }
        button(detailRoot, 'Reload saved Profile', () => { void loadDetail(); });
      } catch {
        if (token === detailEpoch && actor === identityEpoch) unavailable(detailRoot, 503);
      }
    }
    async function loadSummary() {
      if (!identityReady) return;
      const token = ++summaryEpoch, actor = identityEpoch;
      summaryRoot.replaceChildren(node('p', 'Loading Profile summary…'));
      try {
        const result = await read('/api/staff/profile-summary');
        if (token !== summaryEpoch || actor !== identityEpoch) return;
        if (result.status !== 200) { unavailable(summaryRoot, result.status); return; }
        const summary = result.body.summary;
        if (!summary || !summary.groups) throw Error('unavailable');
        const count = value => value === null ? 'Withheld' : Number.isSafeInteger(value) && value >= 0 ? String(value) : 'Unavailable';
        summaryRoot.replaceChildren(node('p', 'Profiles in this summary: ' + count(summary.total_profiles)), node('p', 'Whole-group counts; small groups are withheld. These counts exclude internal test records.'));
        const titles = { date_of_birth: 'Date of birth', race_ethnicity: 'Race or ethnicity', gender: 'Gender', employment: 'Employment' };
        for (const [key, title] of Object.entries(titles)) {
          if (!Array.isArray(summary.groups[key])) continue;
          const table = node('table'); table.append(node('caption', title));
          const thead = node('thead'), heading = node('tr');
          for (const text of ['Answer', 'Count']) { const cell = node('th', text); cell.scope = 'col'; heading.append(cell); }
          thead.append(heading); table.append(thead); const tbody = node('tbody');
          for (const row of summary.groups[key]) { const tr = node('tr'); tr.append(node('td', row.label), node('td', count(row.count))); tbody.append(tr); }
          table.append(tbody); summaryRoot.append(table);
        }
        button(summaryRoot, 'Reload Profile summary', () => { void loadSummary(); });
      } catch {
        if (token === summaryEpoch && actor === identityEpoch) unavailable(summaryRoot, 503);
      }
    }
    // Navigating away or hiding the page removes answers, including admin-only values.
    window.addEventListener('pagehide', beginIdentity);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { resetDetail(); resetSummary(); }
    });
    beginIdentity();
    return { beginIdentity, setIdentity, selectCaregiver, clearCaregiver, loadDetail, loadSummary };
  };
}());
