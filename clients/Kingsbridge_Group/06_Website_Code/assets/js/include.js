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

  Promise.all([
    inject('#header-root', base + '/partials/header.html'),
    inject('#footer-root', base + '/partials/footer.html')
  ]).then(function () {
    document.dispatchEvent(new CustomEvent('partials:ready'));
  });
})();
