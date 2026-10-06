// Lightweight static-site partial loader — single source of truth for header/footer
// across every page, without introducing a build step. Requires the page to be
// served over http(s) (fetch of local files fails under file://).
(function () {
  function inject(selector, url) {
    var root = document.querySelector(selector);
    if (!root) return Promise.resolve();
    return fetch(url)
      .then(function (r) { return r.text(); })
      .then(function (html) { root.innerHTML = html; })
      .catch(function () { /* fails silently to an empty header/footer if offline */ });
  }

  var base = document.body.getAttribute('data-root') || '';

  // Both partial fetches can resolve before the other deferred scripts (main.js,
  // experience.js) have run — preloaded/cached responses come back that fast. Listeners
  // registered by those scripts would then never fire: no mobile menu, no footer details,
  // no gallery arrows, no contact path selection. DOMContentLoaded is guaranteed to come
  // after every deferred script has executed, so the event waits for it.
  // NOTE: document.readyState is already 'interactive' (not 'loading') while deferred
  // scripts run, so it cannot be used to detect this — the previous readyState check let
  // the event fire early on roughly half of page loads in testing. Track DCL directly.
  // This file is always loaded with `defer`, so it runs before DOMContentLoaded.
  var domReady = false, partialsDone = false, fired = false;
  function fire() {
    if (fired || !domReady || !partialsDone) return;
    fired = true;
    document.dispatchEvent(new CustomEvent('partials:ready'));
  }
  document.addEventListener('DOMContentLoaded', function () { domReady = true; fire(); });
  // Safety net if this script were ever loaded after DOMContentLoaded (e.g. without defer).
  window.addEventListener('load', function () { domReady = true; fire(); });
  if (document.readyState === 'complete') domReady = true;

  Promise.all([
    inject('#header-root', base + '/partials/header.html'),
    inject('#footer-root', base + '/partials/footer.html')
  ]).then(function () { partialsDone = true; fire(); });
})();
