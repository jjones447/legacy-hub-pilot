/* Dedicated Profile page. Identity and answers stay in memory, never browser storage. */
(function () {
  'use strict';
  const root = document.getElementById('profilePageEditor');
  if (!root) return;
  const notice = document.getElementById('profilePageStatus');
  const retry = document.getElementById('profilePageReload');
  const logout = document.getElementById('profilePageLogout');
  let epoch = 0, owner = '', stopped = false, starting = false, logoutHold = false;
  const request = window.fetch.bind(window);
  function clear(message) {
    epoch++; owner = ''; editor.clear();
    notice.textContent = message; notice.hidden = false;
  }
  async function identity() {
    const res = await request('/api/portal/me', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    if (res.status !== 200 || res.redirected) throw new Error('session_unavailable');
    const data = await res.json();
    if (!data?.ok || typeof data.profile?.id !== 'string' || !data.profile.id) throw new Error('session_unavailable');
    return data.profile.id;
  }
  async function checkedRequest(url, options) {
    const generation = epoch;
    try {
      const current = await identity();
      if (stopped || generation !== epoch) throw new Error('stale_session');
      if (!owner || current !== owner) {
        clear('Your signed-in account changed. Reload your profile before continuing.');
        throw new Error('changed_session');
      }
      const res = await request(url, options);
      if (generation === epoch && (res.status === 401 || res.status === 403)) {
        clear('Please sign in through the caregiver portal, then return to My Profile.');
      }
      return res;
    } catch (error) {
      if (generation === epoch) clear('Your session could not be checked. Sign in through the portal or reload your profile.');
      throw error;
    }
  }
  const editor = window.createCaregiverProfileEditor(root, {
    epoch: () => epoch, fetch: checkedRequest,
    available(enabled) {
      notice.hidden = enabled;
      if (!enabled && !notice.textContent) notice.textContent = 'Your profile is unavailable. Return to the portal or try again later.';
    }
  });
  async function start() {
    if (starting || stopped) return;
    starting = true; retry.disabled = true;
    clear('Checking your sign-in…');
    const generation = epoch;
    try {
      const current = await identity();
      if (stopped || generation !== epoch) return;
      owner = current;
      window.portalRespiteRefresh?.();
      notice.textContent = 'Your profile is unavailable. Return to the portal or try again later.';
      await editor.load();
    } catch {
      if (generation === epoch) clear('Please sign in through the caregiver portal, then return to My Profile.');
    } finally { starting = false; retry.disabled = stopped; }
  }
  retry.addEventListener('click', () => { void start(); });
  logout.addEventListener('click', async () => {
    if (stopped) return;
    stopped = true; logoutHold = true; logout.disabled = true; retry.disabled = true;
    window.portalRespiteInvalidate?.();
    clear('Signing out…');
    try {
      const res = await request('/api/portal/logout', { method: 'POST', credentials: 'same-origin', redirect: 'error' });
      if (res.status !== 200 || res.redirected || (await res.json())?.ok !== true) throw new Error('unconfirmed');
      notice.textContent = 'You are signed out. Return to the caregiver portal to sign in again.';
    } catch {
      notice.textContent = 'Sign-out could not be confirmed. Close this tab and contact Legacy before trying again.';
    }
  });
  window.addEventListener('pagehide', () => { stopped = true; clear('Return to the portal to continue.'); });
  window.addEventListener('pageshow', event => {
    if (event.persisted && !logoutHold) { stopped = false; logout.disabled = false; void start(); }
  });
  window.addEventListener('focus', async () => {
    if (stopped || starting || !owner) return;
    const generation = epoch;
    // Conceal old answers while checking a session possibly changed in another tab.
    root.hidden = true;
    try {
      const current = await identity();
      if (generation !== epoch || stopped) return;
      if (current !== owner) clear('Your signed-in account changed. Reload your profile before continuing.');
      else root.hidden = !editor.available;
    } catch {
      if (generation === epoch) clear('Your session could not be checked. Sign in through the portal or reload your profile.');
    }
  });
  document.querySelector('[data-action="toggle-nav"]')?.addEventListener('click', () => window.toggleMainNavigation?.());
  void start();
}());
