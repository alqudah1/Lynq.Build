document.addEventListener('partials:ready', function () {
  initHeaderScroll();
  initMobileMenu();
  initActiveNav();
  initFooterYear();
});

// Reveal-on-scroll works on static content already in the DOM, independent of partials.
document.addEventListener('DOMContentLoaded', initScrollReveal);

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
