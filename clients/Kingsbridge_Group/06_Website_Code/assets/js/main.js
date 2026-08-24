document.addEventListener('partials:ready', function () {
  initHeaderScroll();
  initMobileMenu();
  initActiveNav();
  initFooterYear();
  initFooterSocial();
  initFooterOffices();
});

// Reveal-on-scroll works on static content already in the DOM, independent of partials.
document.addEventListener('DOMContentLoaded', initScrollReveal);
document.addEventListener('DOMContentLoaded', initServiceAccordion);

/* Property Management service groups — one open at a time, so the page stays scannable
   instead of showing every service as a wall of text at once. */
function initServiceAccordion() {
  var items = document.querySelectorAll('.sa-item');
  if (!items.length) return;
  items.forEach(function (item) {
    var trigger = item.querySelector('.sa-trigger');
    trigger.addEventListener('click', function () {
      var alreadyOpen = item.classList.contains('is-open');
      items.forEach(function (other) {
        other.classList.remove('is-open');
        other.querySelector('.sa-trigger').setAttribute('aria-expanded', 'false');
      });
      if (!alreadyOpen) {
        item.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

// Delegated on document, so it works before/after partials inject the nav — no need to
// wait for partials:ready.
document.addEventListener('DOMContentLoaded', initFastAnchorScroll);

/* Same-page anchor links (nav -> #custom-homes, #property-management, #about) get a short,
   fixed-duration scroll instead of the browser's native smooth-scroll, whose duration scales
   with distance and felt slow on a long page. Also compensates for the fixed header, which
   otherwise covers the top of the target section. */
function initFastAnchorScroll() {
  var DURATION = 280;
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href*="#"]');
    if (!a) return;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var url;
    try { url = new URL(a.getAttribute('href'), window.location.href); } catch (err) { return; }
    if (url.pathname !== window.location.pathname || !url.hash) return;
    var target = document.getElementById(url.hash.slice(1));
    if (!target) return;

    e.preventDefault();
    var header = document.getElementById('site-header');
    var offset = header ? header.getBoundingClientRect().height + 16 : 0;
    var startY = window.scrollY;
    var endY = Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset);

    if (REDUCED) {
      window.scrollTo(0, endY);
      history.pushState(null, '', url.hash);
      return;
    }

    var distance = endY - startY;
    var startTime = null;
    function step(ts) {
      if (!startTime) startTime = ts;
      var progress = Math.min((ts - startTime) / DURATION, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      window.scrollTo(0, startY + distance * eased);
      if (progress < 1) requestAnimationFrame(step);
      else history.pushState(null, '', url.hash);
    }
    requestAnimationFrame(step);
  });
}

function initHeaderScroll() {
  var header = document.getElementById('site-header');
  if (!header) return;
  function update() {
    if (window.scrollY > 40) header.classList.add('solid');
    else header.classList.remove('solid');
  }
  update();
  window.addEventListener('scroll', update, { passive: true });
}

function initMobileMenu() {
  var toggle = document.getElementById('nav-toggle');
  if (!toggle) return;
  toggle.addEventListener('click', function () {
    var open = document.body.classList.toggle('menu-open');
    toggle.setAttribute('aria-expanded', open);
  });
  document.querySelectorAll('#mobile-menu a').forEach(function (a) {
    a.addEventListener('click', function () { document.body.classList.remove('menu-open'); });
  });
}

function initActiveNav() {
  var current = document.body.getAttribute('data-page');
  if (!current) return;
  document.querySelectorAll('[data-nav]').forEach(function (a) {
    if (a.getAttribute('data-nav') === current) a.classList.add('active');
  });
}

function initFooterYear() {
  var el = document.getElementById('footer-year');
  if (el) el.textContent = new Date().getFullYear();
}

// Renders only if real links exist in KB_CONFIG.social (assets/js/site-config.js) — an empty
// footer row is preferable to placeholder icons pointing nowhere.
function initFooterSocial() {
  var el = document.getElementById('footer-social');
  if (!el || typeof KB_CONFIG === 'undefined' || !KB_CONFIG.social || !KB_CONFIG.social.length) return;
  el.innerHTML = KB_CONFIG.social.map(function (s) {
    return '<a href="' + s.url + '" target="_blank" rel="noopener">' + s.label + '</a>';
  }).join('');
}

// Office locations, shown subtly in the footer once confirmed (assets/js/site-config.js).
function initFooterOffices() {
  var el = document.getElementById('footer-offices');
  if (!el || typeof KB_CONFIG === 'undefined' || !KB_CONFIG.offices || !KB_CONFIG.offices.length) return;
  el.innerHTML = KB_CONFIG.offices.map(function (o) {
    return '<span>' + o.label + '</span>';
  }).join('');
}

function initScrollReveal() {
  var items = document.querySelectorAll('[data-reveal]');
  if (!items.length) return;
  if (!('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });
  items.forEach(function (el) { io.observe(el); });
}
