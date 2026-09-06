// Kingsbridge Group — restrained experience layer: a one-time intro mark, page
// transitions, gentle image parallax, and a desktop cursor accent. The
// scroll-driven hero sequence and the pinned Design/Build/Property
// Management gallery are gone — the client asked for a stationary hero (see
// 06_Website_Code/development-plan.md) and a static editorial layout, not
// scroll-hijacking. Every remaining effect here checks prefers-reduced-motion
// and degrades to instant/static — nothing here gates access to content.

var KB_REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

document.addEventListener('DOMContentLoaded', function () {
  initIntroSequence();
  initPageTransitions();
  initHeroParallax();
  initCustomCursor();
});

document.addEventListener('partials:ready', function () {
  initPageTransitions(); // header/footer links exist only after partials load
});

/* ---------------- INTRO SEQUENCE (home page, once per session) ---------------- */
function initIntroSequence() {
  var veil = document.getElementById('intro-veil');
  if (!veil) return;
  if (KB_REDUCED_MOTION || sessionStorage.getItem('kb-intro-seen')) {
    veil.remove();
    return;
  }
  sessionStorage.setItem('kb-intro-seen', '1');
  setTimeout(function () { veil.classList.add('show'); }, 200);
  setTimeout(function () { veil.classList.add('draw'); }, 600);
  setTimeout(function () { veil.classList.add('hide'); }, 1500);
  setTimeout(function () { veil.remove(); }, 2200);
}

/* ---------------- PAGE TRANSITION VEIL ---------------- */
function initPageTransitions() {
  var veil = document.getElementById('page-veil');
  if (!veil || veil.dataset.bound) return;
  veil.dataset.bound = '1';

  document.addEventListener('click', function (e) {
    if (KB_REDUCED_MOTION) return;
    var a = e.target.closest && e.target.closest('a[href^="/"]');
    if (!a) return;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target === '_blank' || a.hasAttribute('download')) return;
    var href = a.getAttribute('href');
    if (!href) return;
    var url = new URL(href, window.location.href);
    // Same-page anchor (e.g. nav links to /#custom-homes while already on /): let the browser
    // handle it natively. This must never be intercepted — there is no page to transition to.
    if (url.pathname === window.location.pathname && url.hash) return;
    if (href === window.location.pathname) return;
    e.preventDefault();
    veil.classList.add('active');
    setTimeout(function () { window.location.href = href; }, 200);
  });
}

/* ---------------- HERO / CONCEPT AMBIENT PARALLAX ---------------- */
function initHeroParallax() {
  if (KB_REDUCED_MOTION) return;
  var targets = document.querySelectorAll('[data-parallax] .ph-photo');
  if (!targets.length) return;
  var ticking = false;
  function update() {
    targets.forEach(function (el) {
      var rect = el.closest('[data-parallax]').getBoundingClientRect();
      var progress = (window.innerHeight - rect.top) / (window.innerHeight + rect.height);
      var shift = Math.max(-1, Math.min(1, progress - 0.5)) * 24;
      el.style.transform = 'translateY(' + shift + 'px)';
    });
    ticking = false;
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }, { passive: true });
  update();
}

/* ---------------- CUSTOM CURSOR ACCENT (desktop pointer only) ---------------- */
function initCustomCursor() {
  if (KB_REDUCED_MOTION) return;
  if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  var dot = document.createElement('div');
  dot.className = 'kb-cursor';
  document.body.appendChild(dot);

  var x = 0, y = 0, tx = 0, ty = 0, active = false;
  window.addEventListener('mousemove', function (e) {
    x = e.clientX; y = e.clientY;
    if (!active) { active = true; dot.classList.add('active'); }
  }, { passive: true });
  document.addEventListener('mouseleave', function () { dot.classList.remove('active'); });

  function loop() {
    tx += (x - tx) * 0.2; ty += (y - ty) * 0.2;
    dot.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0) translate(-50%,-50%)';
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  document.addEventListener('mouseover', function (e) {
    var t = e.target.closest && e.target.closest('a, button, .path-pill');
    dot.classList.toggle('hover', !!t);
  });
}

