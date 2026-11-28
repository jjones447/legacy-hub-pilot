import { mountRespitePanel } from './portal-respite-ui.mjs';

const isProof = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function bindRespitePage(win) {
  const doc = win.document;
  const nav = doc.getElementById('portalRespiteTab');
  const ownerRoot = doc.getElementById('respite');
  const staffRoot = doc.getElementById('staffRespite');
  if (!nav && !staffRoot) return;
  const dashboard = doc.getElementById('portalDashboardContent');
  const dashboardTab = doc.getElementById('portalDashboardTab');
  const dashboardLogout = doc.getElementById('portalLogoutBtn');
  const profileLogout = doc.getElementById('profilePageLogout');
  const base = staffRoot ? '/api/staff/respite' : '/api/portal/respite';
  let session, acknowledgment, panel, epoch = 0, refreshId = 0, suspended = false;

  function selection(active) {
    if (!ownerRoot) return;
    ownerRoot.hidden = !active;
    dashboard.hidden = active;
    if (active) {
      dashboardTab.removeAttribute('aria-current');
      nav.setAttribute('aria-current', 'page');
    } else {
      nav.removeAttribute('aria-current');
      dashboardTab.setAttribute('aria-current', 'page');
    }
  }

  function invalidate() {
    epoch++;
    refreshId++;
    session = acknowledgment = undefined;
    panel?.reset();
    selection(false);
    if (nav) nav.hidden = true;
    if (staffRoot) {
      staffRoot.replaceChildren();
      staffRoot.hidden = true;
    }
  }

  async function request(suffix, headers, body) {
    const options = {
      credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: {Accept: 'application/json', ...headers},
    };
    if (body !== undefined) {
      options.method = 'POST';
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await win.fetch(base + suffix, options);
    if (response.redirected || !/^application\/json\b/i.test(response.headers.get('content-type') || '')) {
      throw Error('invalid_respite_response');
    }
    const result = await response.json();
    if (typeof result?.ok !== 'boolean' || result.ok !== response.ok) throw Error('invalid_respite_response');
    return result;
  }

  async function identity() {
    const check = await request('/session');
    if (!check.ok || typeof check.principal !== 'string' || !isProof(check.proof)
      || typeof check.visible !== 'boolean' || (dashboard && check.principal !== win.portalFunctionalOwner)) {
      throw Error('invalid_respite_session');
    }
    return check;
  }

  function sameSession(current, previous) {
    return current.principal === previous.principal && current.proof === previous.proof;
  }

  async function checkedRequest(suffix, body) {
    const generation = epoch;
    const original = session;
    if (suspended || !original?.visible) throw Error('invalid_respite_session');
    let current;
    try {
      current = await identity();
      if (!sameSession(current, original) || !current.visible) throw Error('respite_session_changed');
    } catch (error) {
      if (epoch === generation) invalidate();
      throw error;
    }
    if (epoch !== generation) throw Error('stale_respite_session');
    const headers = {'X-Respite-Session': original.proof};
    if (suffix === '/request' && acknowledgment) headers['X-Respite-Acknowledgments'] = acknowledgment;
    let result;
    try {
      result = await request(suffix, headers, body);
    } catch {
      if (body === undefined) throw Error('invalid_respite_response');
      return {ok: false, error: 'outcome_unknown'};
    }
    if (epoch !== generation) throw Error('stale_respite_session');
    if (['session_changed', 'unauthorized', 'forbidden'].includes(result.error)) invalidate();
    return result;
  }

  if (ownerRoot) {
    panel = mountRespitePanel(ownerRoot, {
      async read() {
        const view = await checkedRequest('');
        acknowledgment = view.visible && isProof(view.acknowledgment_proof) ? view.acknowledgment_proof : undefined;
        return acknowledgment ? view : {ok: false};
      },
      createParticipant(body) { return checkedRequest('/participant', body); },
      createPendingRequest(body) { return checkedRequest('/request', body); },
    }, {onVisibilityChange: selection});
  }

  function renderStaff(result) {
    const title = doc.createElement('h2');
    title.textContent = 'Pending Respite requests';
    const list = doc.createElement('ul');
    const format = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chicago',
    });
    for (const item of result.requests) {
      const row = doc.createElement('li');
      const start = new Date(item.starts_at);
      const date = Number.isNaN(start.valueOf()) ? '' : ' · ' + format.format(start) + ' Central';
      row.textContent = item.event_title + date + (item.first_time ? ' · First visit' : '');
      list.append(row);
    }
    const empty = doc.createElement('p');
    empty.textContent = 'No pending requests.';
    staffRoot.replaceChildren(title, list.children.length ? list : empty);
    staffRoot.hidden = false;
  }

  async function refresh({load = false} = {}) {
    if (suspended || dashboardLogout?.disabled || profileLogout?.disabled
      || (dashboard && !win.portalFunctionalOwner)) return;
    const check = ++refreshId;
    if (ownerRoot && !ownerRoot.hidden) ownerRoot.hidden = true;
    if (staffRoot) staffRoot.hidden = true;
    try {
      const current = await identity();
      if (check !== refreshId) return;
      const changed = !session || !sameSession(current, session);
      if (changed || !current.visible || load) {
        epoch++;
        acknowledgment = undefined;
        panel?.reset();
      }
      session = current;
      if (nav) nav.hidden = !current.visible;
      if (!current.visible) return;
      if (staffRoot) {
        const result = await checkedRequest('');
        if (check === refreshId && result.ok && Array.isArray(result.requests)) renderStaff(result);
      } else if (ownerRoot && win.location.hash === '#respite') {
        if (changed || load || !ownerRoot.firstChild) await panel.load();
        else selection(true);
      }
    } catch {
      if (check === refreshId) invalidate();
    }
  }

  function navigate() {
    if (!ownerRoot) return;
    if (win.location.hash === '#respite') void refresh({load: true});
    else {
      epoch++;
      refreshId++;
      acknowledgment = undefined;
      panel.reset();
    }
  }

  function hide() { suspended = true; invalidate(); }
  function show() { suspended = false; void refresh(); }
  function focus() { void refresh(); }
  win.addEventListener('pagehide', hide);
  win.addEventListener('pageshow', show);
  win.addEventListener('focus', focus);
  win.addEventListener('hashchange', navigate);
  if (nav) {
    win.portalRespiteInvalidate = invalidate;
    win.portalRespiteRefresh = focus;
  }
  void refresh();
  return () => {
    hide();
    win.removeEventListener('pagehide', hide);
    win.removeEventListener('pageshow', show);
    win.removeEventListener('focus', focus);
    win.removeEventListener('hashchange', navigate);
    if (nav) {
      delete win.portalRespiteInvalidate;
      delete win.portalRespiteRefresh;
    }
  };
}

if (typeof window !== 'undefined') bindRespitePage(window);
