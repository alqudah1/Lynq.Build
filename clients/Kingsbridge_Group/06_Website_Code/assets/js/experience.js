// Kingsbridge Group — cinematic experience layer: intro sequence, page
// transitions, the pinned Create/Build/Manage gallery, parallax, and
// portfolio prev/next. Every effect here checks prefers-reduced-motion and
// degrades to instant/static — nothing here gates access to content.

var KB_REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

document.addEventListener('DOMContentLoaded', function () {
  initIntroSequence();
  initPageTransitions();
  initHeroParallax();
  initHeroStory();
  initCbmCinema();
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
  requestAnimationFrame(function () { veil.classList.add('draw-bp'); });
  setTimeout(function () { veil.classList.add('show'); }, 650);
  setTimeout(function () { veil.classList.add('draw'); }, 1050);
  setTimeout(function () { veil.classList.add('hide'); }, 1950);
  setTimeout(function () { veil.remove(); }, 2700);
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
    if (!href || href === window.location.pathname) return;
    e.preventDefault();
    veil.classList.add('active');
    setTimeout(function () { window.location.href = href; }, 420);
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

/* ---------------- HERO STORY — VISION / DESIGN / BUILD / MANAGEMENT (GSAP ScrollTrigger) ---------------- */
function initHeroStory() {
  var section = document.getElementById('hero-story');
  if (!section) return;
  // Mobile / reduced-motion: CSS fallback already shows a single static frame — no JS needed.
  if (KB_REDUCED_MOTION) return;
  if (!window.matchMedia || !window.matchMedia('(min-width: 900px)').matches) return;
  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;
  gsap.registerPlugin(ScrollTrigger);

  var blueprintWrap = section.querySelector('.hs-blueprint');
  var elevation = section.querySelector('.hs-bp-elevation');
  var plan = section.querySelector('.hs-bp-plan');
  var photoStages = section.querySelectorAll('.hs-stage[data-stage]:not(.hs-blueprint)');
  var label = document.getElementById('hs-stage-label');
  var dots = document.querySelectorAll('#hs-progress span');
  var labelText = ['Vision', 'Vision', 'Design', 'Build', 'Completion', 'Management'];
  var dotIndex = [0, 0, 1, 2, 3, 4];

  var tl = gsap.timeline({
    scrollTrigger: { trigger: section, start: 'top top', end: 'bottom bottom', scrub: 0.6 }
  });

  tl.to(elevation, { opacity: 0, duration: 0.8, ease: 'none' }, 0.6)
    .fromTo(plan, { opacity: 0 }, { opacity: 1, duration: 0.8, ease: 'none' }, 0.6)
    .to(blueprintWrap, { opacity: 0, duration: 0.8, ease: 'none' }, 1.6)
    .fromTo(photoStages[0], { opacity: 0, scale: 1.05 }, { opacity: 1, scale: 1, duration: 0.8, ease: 'none' }, 1.6)
    .to(photoStages[0], { opacity: 0, duration: 0.8, ease: 'none' }, 2.6)
    .fromTo(photoStages[1], { opacity: 0, scale: 1.05 }, { opacity: 1, scale: 1, duration: 0.8, ease: 'none' }, 2.6)
    .to(photoStages[1], { opacity: 0, duration: 0.8, ease: 'none' }, 3.6)
    .fromTo(photoStages[2], { opacity: 0, scale: 1.05 }, { opacity: 1, scale: 1, duration: 0.8, ease: 'none' }, 3.6)
    .to(photoStages[2], { opacity: 0, duration: 0.8, ease: 'none' }, 4.6)
    .fromTo(photoStages[3], { opacity: 0, scale: 1.05 }, { opacity: 1, scale: 1, duration: 0.8, ease: 'none' }, 4.6);

  ScrollTrigger.create({
    trigger: section, start: 'top top', end: 'bottom bottom', scrub: true,
    onUpdate: function (self) {
      var seg = Math.min(5, Math.floor(self.progress * 6));
      if (label) label.textContent = labelText[seg];
      dots.forEach(function (d, i) { d.classList.toggle('current', i === dotIndex[seg]); });
    }
  });
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

/* ---------------- CREATE / BUILD / MANAGE — PINNED HORIZONTAL GALLERY ---------------- */
function initCbmCinema() {
  var cinema = document.getElementById('cbm-cinema');
  var track = document.getElementById('cbm-track');
  if (!cinema || !track) return;
  var slides = track.querySelectorAll('.cbm-slide');
  var dots = document.querySelectorAll('.cbm-progress span');

  function enabled() {
    return !KB_REDUCED_MOTION && window.matchMedia('(min-width: 900px)').matches;
  }
  if (!enabled()) return; // CSS fallback already stacks slides vertically
  cinema.classList.add('pinned');

  var ticking = false;
  function update() {
    var rect = cinema.getBoundingClientRect();
    var total = rect.height - window.innerHeight;
    var progress = total > 0 ? Math.max(0, Math.min(1, -rect.top / total)) : 0;
    track.style.transform = 'translateX(' + (-progress * (slides.length - 1) * 100) + '%)';
    cinema.classList.toggle('active', rect.top < window.innerHeight && rect.bottom > 0);
    var idx = Math.round(progress * (slides.length - 1));
    dots.forEach(function (d, i) { d.classList.toggle('current', i === idx); });
    ticking = false;
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }, { passive: true });
  update();
}
