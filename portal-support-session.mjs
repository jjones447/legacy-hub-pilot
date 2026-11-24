// A view and its outstanding requests belong to one verified identity.
export function createSupportSession(fetchImpl = globalThis.fetch, role = 'owner') {
  const staff = role === 'staff';
  let owner = '', epoch = 0, stopped = false, view = null;

  function invalidate() {
    epoch++;
    owner = '';
    view?.reset();
  }

  async function identity() {
    const response = await fetchImpl(staff ? '/api/staff/me?support=1' : '/api/portal/me?support=1', {
      credentials: 'same-origin', cache: 'no-store', redirect: 'error'
    });
    if (response.status !== 200 || response.redirected) throw Error('session_unavailable');
    const body = await response.json();
    const id = staff ? body.me?.email : body.profile?.id;
    if (body.ok !== true || typeof id !== 'string' || !id) throw Error('session_unavailable');
    if (body.capabilities?.support_requests === false) throw Error('support_disabled');
    if (body.capabilities?.support_requests !== true) throw Error('session_unavailable');
    if (staff && (body.me.status !== 'active' || !['admin', 'staff'].includes(body.me.role))) {
      throw Error('session_unavailable');
    }
    return id;
  }

  async function start(expected) {
    const generation = epoch;
    try {
      const current = await identity();
      if (stopped || generation !== epoch) throw Error('stale_session');
      if ((owner && current !== owner) || (expected && current !== expected)) throw Error('changed_session');
      owner = current;
      return current;
    } catch (error) {
      if (generation === epoch) invalidate();
      throw error;
    }
  }

  async function checkedFetch(url, options) {
    if (stopped || !owner) throw Error('session_unavailable');
    const generation = epoch;
    await start(owner);
    if (stopped || generation !== epoch) throw Error('stale_session');
    const response = await fetchImpl(url, options);
    if (stopped || generation !== epoch) throw Error('stale_session');
    if (response.status === 401 || response.status === 403) invalidate();
    return response;
  }

  return {
    start, fetch: checkedFetch, invalidate,
    attach(next) {
      view = next;
      return () => {
        if (view === next) { invalidate(); view = null; next.dispose(); }
      };
    },
    dispose() { stopped = true; invalidate(); view?.dispose(); view = null; }
  };
}
