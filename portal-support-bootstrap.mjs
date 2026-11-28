import {createSupportMounts} from './portal-support-entry.mjs';
import {createSupportSession} from './portal-support-session.mjs';

// Portal login and logout own the dashboard identity. The public Support page
// and the Staff console each qualify their current session on their own route.
export function bindSupportPage(win) {
  const doc = win.document;
  const staffRoot = doc.getElementById('staffFunctionalSupport');
  const root = staffRoot || doc.getElementById('portalFunctionalSupport');
  if (!root) return;
  const dashboard = doc.getElementById('dashView');
  const publicForm = doc.getElementById('supportLegacyPublicForm');
  const mounts = createSupportMounts(doc);
  const session = createSupportSession(win.fetch.bind(win), staffRoot ? 'staff' : 'owner');
  let view = null, generation = 0, suspended = false;
  const notice = doc.createElement('p');
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  root.after(notice);

  function clear() {
    view = null;
    if (staffRoot) mounts.resetStaff();
    else mounts.resetOwner();
    notice.hidden = true;
  }
  session.attach({reset: clear, dispose: clear});

  function invalidate() {
    generation++;
    session.invalidate();
  }

  async function refresh() {
    const expectedOwner = dashboard ? win.portalFunctionalOwner : null;
    if (suspended || (dashboard && (!expectedOwner || doc.getElementById('portalLogoutBtn')?.disabled))) return;
    const current = ++generation;
    root.hidden = true;
    if (publicForm) publicForm.inert = true;
    try {
      await session.start(expectedOwner);
      if (current !== generation) return;
      if (!view) view = staffRoot ? mounts.mountStaff(session.fetch) : mounts.mountOwner(session.fetch);
      root.hidden = false;
      notice.hidden = true;
      if (publicForm) publicForm.hidden = true;
      if (dashboard) dashboard.dataset.functionalSupport = 'active';
    } catch (error) {
      if (current !== generation) return;
      if (error.message === 'support_disabled') {
        if (publicForm) publicForm.hidden = false;
        if (dashboard) delete dashboard.dataset.functionalSupport;
      }
      if (publicForm?.hidden) {
        notice.textContent = 'Sign in through the caregiver portal to return to your support requests.';
        notice.hidden = false;
      }
    } finally {
      if (publicForm && current === generation) publicForm.inert = publicForm.hidden;
    }
  }
  function hide() { suspended = true; invalidate(); }
  function show() { suspended = false; void refresh(); }
  win.addEventListener('pagehide', hide);
  win.addEventListener('pageshow', show);
  win.addEventListener('focus', refresh);
  if (dashboard) {
    win.portalSupportInvalidate = invalidate;
    win.portalSupportRefresh = refresh;
  }
  void refresh();
  return () => {
    hide();
    session.dispose();
    win.removeEventListener('pagehide', hide);
    win.removeEventListener('pageshow', show);
    win.removeEventListener('focus', refresh);
    if (dashboard) {
      delete win.portalSupportInvalidate;
      delete win.portalSupportRefresh;
    }
    notice.remove();
  };
}
if (typeof window !== 'undefined') bindSupportPage(window);
