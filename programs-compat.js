// HTTP never receives a fragment. Old membership bookmarks arrive here after
// the /programs(.html) 301; the visible anchor link is the no-JS fallback.
(() => {
  function routeLegacyMembership() {
    if (location.hash === '#membership') location.replace('membership.html');
  }
  routeLegacyMembership();
  window.addEventListener('hashchange', routeLegacyMembership);
})();
