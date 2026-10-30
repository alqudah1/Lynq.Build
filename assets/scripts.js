// scripts.js — LYNQ

// ── Preloader ─────────────────────────────────────────────────────────────────
//
// The preloader CSS animation slides the overlay up at ~1100ms.
// JS removes it from the DOM at 1550ms (1100 + 400 duration + 50ms buffer)
// and removes body.preloading so gated hero animations begin playing.
// On reduced-motion, skip straight to removal after one tick.

(function initPreloader() {
  const preloader = document.getElementById('preloader');
  if (!preloader) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const delay = reducedMotion ? 0 : 1550;

  setTimeout(() => {
    preloader.remove();
    document.body.classList.remove('preloading');
  }, delay);
})();


// ── Page transitions ──────────────────────────────────────────────────────────
//
// navigateTo(url) — call this instead of setting window.location directly.
//   1. Slides #page-transition down over the page (0.6s)
//   2. Waits 0.3s (total 0.9s) then sets window.location.href
//   A sessionStorage flag tells the next page to play the reverse (exit) animation.
//
// The delegated click listener intercepts same-origin <a> clicks automatically,
// so any future page links added to the HTML will get the transition for free.

function navigateTo(url) {
  const overlay = document.getElementById('page-transition');
  sessionStorage.setItem('lynq-transition', '1');
  overlay.classList.add('is-entering');
  setTimeout(() => { window.location.href = url; }, 280); // 220ms anim + 60ms hold
}

// On arrival: if we came via navigateTo, start covered then sweep up to reveal
(function handlePageEnter() {
  if (!sessionStorage.getItem('lynq-transition')) return;
  sessionStorage.removeItem('lynq-transition');

  const overlay = document.getElementById('page-transition');
  // Start fully covering the page (no transition yet)
  overlay.style.transition = 'none';
  overlay.style.transform  = 'translateY(0)';

  // Double rAF ensures the browser has painted the covered state before animating
  requestAnimationFrame(() => requestAnimationFrame(() => {
    overlay.style.transition = '';      // restore CSS transition
    overlay.classList.add('is-exiting'); // sweeps up to reveal page
  }));
})();

// Intercept same-origin <a> clicks — skips anchors (#), new-tab, and external
document.addEventListener('click', e => {
  const link = e.target.closest('a[href]');
  if (!link) return;

  const href = link.getAttribute('href');
  if (!href || href.startsWith('#'))       return; // anchor / empty
  if (link.target === '_blank')            return; // new tab
  if (/^(mailto|tel):/.test(href))         return; // protocol links

  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return; // external
  } catch { return; }

  e.preventDefault();
  navigateTo(href);
});


// ── Mobile hamburger nav ──────────────────────────────────────────────────────
(function initHamburger() {
  const btn    = document.getElementById('navHamburger');
  const drawer = document.getElementById('navMobile');
  if (!btn || !drawer) return;

  function closeMenu() {
    btn.classList.remove('open');
    drawer.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  btn.addEventListener('click', () => {
    const opening = !btn.classList.contains('open');
    if (opening) {
      btn.classList.add('open');
      drawer.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      drawer.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    } else {
      closeMenu();
    }
  });

  // Close when a nav link is tapped
  drawer.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', closeMenu);
  });

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMenu();
  });
})();

// ── Lenis smooth scroll ───────────────────────────────────────────────────────
//
// Drives the native scroll position through Lenis's momentum model so every
// wheel/touch event feels weighted. The rAF loop calls lenis.raf(time) each
// frame — Lenis updates scrollY and fires native 'scroll' events, so the
// parallax listener and Intersection Observers below work without changes.

// Disable Lenis on touch devices — iOS Safari's native momentum scroll
// feels better and Lenis touchMultiplier can cause erratic behaviour.
const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

const lenis = new Lenis({
  duration: 0.6,
  easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // expo ease-out
  smoothWheel: !isTouchDevice,
  wheelMultiplier: 1,
  touchMultiplier: isTouchDevice ? 0 : 2,
});

(function lenisRaf(time) {
  lenis.raf(time);
  requestAnimationFrame(lenisRaf);
})(0);


// ── Split-text headline reveal ────────────────────────────────────────────────
//
// Rewrites the hero h1 so each word is wrapped in:
//   <span class="word">          ← overflow:hidden clip mask
//     <span class="word-inner">  ← animated layer, slides up from below
//
// <br> tags and <span class="thin"> wrappers are preserved exactly.
// The h1's .fade-in class is removed — per-word animation replaces it.
// The sub paragraph's delay is pushed back to follow the last word.

(function splitHeadline() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const h1 = document.querySelector('.hero-headline');
  if (!h1) return;

  const BASE_DELAY = 220; // ms before the first word appears
  const STAGGER    = 80;  // ms between each successive word

  // Snapshot childNodes before clearing — includes text, <br>, and <span.thin>
  const nodes     = [...h1.childNodes];
  let   wordIndex = 0;

  h1.classList.remove('fade-in'); // whole-element fade replaced by per-word reveal
  h1.innerHTML = '';

  function makeWord(content) {
    const outer = document.createElement('span');
    outer.className = 'word';

    const inner = document.createElement('span');
    inner.className = 'word-inner';
    // Delay is driven by a CSS custom property so the animation system owns timing
    inner.style.setProperty('--word-delay', `${BASE_DELAY + wordIndex++ * STAGGER}ms`);

    if (typeof content === 'string') {
      inner.textContent = content;
    } else {
      inner.appendChild(content); // e.g. <span class="thin">that</span>
    }

    outer.appendChild(inner);
    return outer;
  }

  nodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      // Split text into individual words; trim handles leading/trailing whitespace
      const words = node.textContent.trim().split(/\s+/).filter(Boolean);
      words.forEach(word => {
        h1.appendChild(makeWord(word));
        // Space text node between words — HTML collapses extras near <br>
        h1.appendChild(document.createTextNode(' '));
      });

    } else if (node.nodeName === 'BR') {
      h1.appendChild(document.createElement('br'));

    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Treat any inline element (e.g. <span class="thin">) as one word unit
      h1.appendChild(makeWord(node.cloneNode(true)));
      h1.appendChild(document.createTextNode(' '));
    }
  });

  // Push the sub paragraph's delay to follow after the last headline word
  // starts animating, with 350ms overlap so it feels connected not detached.
  const sub = document.querySelector('.hero-sub');
  if (sub) {
    const lastWordStart = BASE_DELAY + (wordIndex - 1) * STAGGER;
    sub.style.animationDelay = `${lastWordStart + 350}ms`;
  }
})();


// ── Scroll-reveal via Intersection Observer ───────────────────────────────────
//
// Strategy: add .reveal (hidden state) to elements before observation.
// IO adds .visible (shown state). After the transition completes, .reveal
// is removed so it doesn't block hover transforms on .work-card etc.

const STAGGER = 100; // ms between staggered items

function prepReveal(el, delay) {
  el.classList.add('reveal');
  if (delay) el.style.setProperty('--reveal-delay', `${delay}ms`);
}

function applyVisible(el) {
  el.classList.add('visible');
  // Clean up after transition so hover rules aren't blocked by reveal specificity
  el.addEventListener('transitionend', function cleanup(e) {
    if (e.propertyName !== 'transform') return;
    el.classList.remove('reveal');
    el.style.removeProperty('--reveal-delay');
    el.removeEventListener('transitionend', cleanup);
  });
}

// Process section — header and summary are single reveals
document.querySelectorAll('.process-header, .process-summary').forEach(el => {
  prepReveal(el);
});

// Process grid children in DOM order: step → arrow → step → arrow → step
// Staggered so they cascade left to right
document.querySelectorAll('.process-grid > *').forEach((el, i) => {
  prepReveal(el, i * STAGGER);
});

// Work section label
document.querySelectorAll('.work-label').forEach(el => prepReveal(el));

// Work cards — staggered one by one
document.querySelectorAll('.work-card').forEach((el, i) => {
  prepReveal(el, i * STAGGER);
});

// FAQ section
document.querySelectorAll('.faq-header').forEach(el => prepReveal(el));
document.querySelectorAll('.faq-item').forEach((el, i) => {
  prepReveal(el, i * STAGGER);
});

// Services section
document.querySelectorAll('.services-header').forEach(el => prepReveal(el));
document.querySelectorAll('.service-card').forEach((el, i) => {
  prepReveal(el, i * STAGGER);
});

// Why LYNQ section
document.querySelectorAll('.why-lynq-header').forEach(el => prepReveal(el));
document.querySelectorAll('.why-card').forEach((el, i) => {
  prepReveal(el, i * STAGGER);
});

// Testimonials section
document.querySelectorAll('.testimonials-header').forEach(el => prepReveal(el));
document.querySelectorAll('.testi-card').forEach((el, i) => {
  prepReveal(el, i * STAGGER);
});

// Pricing section
document.querySelectorAll('.pricing-header').forEach(el => prepReveal(el));
document.querySelectorAll('.pricing-card').forEach((el, i) => {
  prepReveal(el, i * STAGGER);
});

// Audit CTA section
document.querySelectorAll('.audit-cta-inner').forEach(el => prepReveal(el));

// Contact section — heading, sub, form cascade in
['.contact-heading', '.contact-sub', '.contact-form'].forEach((sel, i) => {
  document.querySelectorAll(sel).forEach(el => prepReveal(el, i * STAGGER));
});

// Footer — logo, top-btn, nav, socials, copy cascade in
['.footer-logo', '.footer-top-btn', '.footer-nav', '.footer-socials', '.footer-copy'].forEach((sel, i) => {
  document.querySelectorAll(sel).forEach(el => prepReveal(el, i * STAGGER));
});

// Observe every prepared element
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    applyVisible(entry.target);
    revealObserver.unobserve(entry.target); // fire once, then stop watching
  });
}, {
  threshold: 0.12,
  rootMargin: '0px 0px -40px 0px', // trigger just before element fully enters
});

document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));


// ── Hero background parallax ──────────────────────────────────────────────────
//
// Only translates compositor-managed layer (transform on a will-change element).
// Throttled to one rAF per scroll event. Stops updating once hero leaves view.

const heroBg   = document.querySelector('.hero-bg');
const hero     = document.querySelector('.hero');
let   rafQueued = false;

function applyParallax() {
  const scrollY     = window.scrollY;
  const heroHeight  = hero.offsetHeight;

  // No-op once hero has fully scrolled past — avoids unnecessary rAFs
  if (scrollY < heroHeight) {
    // Positive translateY makes bg drift down slower than the page scrolls up,
    // creating the classic parallax depth effect. 0.15× is subtle and safe
    // given the extra ±15% height on .hero-bg.
    heroBg.style.transform = `translateY(${scrollY * 0.15}px)`;
  }

  rafQueued = false;
}

window.addEventListener('scroll', () => {
  if (!rafQueued) {
    rafQueued = true;
    requestAnimationFrame(applyParallax);
  }
}, { passive: true });


// ── Section divider draw animation ───────────────────────────────────────────
//
// Dedicated observer — separate from the reveal observer because:
//   • Different trigger class (.drawn not .visible)
//   • threshold: 0 fires the moment a 1px element enters the viewport,
//     which is what we want for a line sitting between sections
//   • rootMargin pulls the trigger point 6% up from the viewport bottom
//     so the draw starts just before the line is fully on screen

const dividerObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('drawn');
    dividerObserver.unobserve(entry.target);
  });
}, {
  threshold: 0,
  rootMargin: '0px 0px -6% 0px',
});

document.querySelectorAll('.section-divider').forEach(el => dividerObserver.observe(el));


// ── Process timeline draw-on-scroll ───────────────────────────────────────────
//
// Adds .drawn to .process-timeline when the process section enters the
// viewport. CSS transitions handle the scaleX line and dot pop-ins.

const timelineObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('drawn');
    timelineObserver.unobserve(entry.target);
  });
}, {
  threshold: 0.3,
});

const processTimeline = document.querySelector('.process-timeline');
if (processTimeline) timelineObserver.observe(processTimeline);


// ── Magnetic tilt on work cards ───────────────────────────────────────────────
//
// Single rAF loop shared across all cards — stops automatically when every
// card has settled, so there is zero idle cost between interactions.
//
// JS takes ownership of .work-card's transform for the duration of a hover
// (handling both the tilt and the lift that CSS normally does via :hover).
// The CSS transition is suppressed via inline style while JS is animating,
// then restored once the card snaps back to rest.
//
// Child-level hover styles (.work-meta translateX, thumb box-shadow, etc.)
// are on separate elements and driven by CSS :hover — they work normally.

// ── Custom cursor ─────────────────────────────────────────────────────────────
//
// Architecture:
//   • Single <div id="cursor"> injected by JS — no HTML change needed
//   • Position driven entirely by `transform` (compositor-only, no layout)
//   • calc(Xpx - 50%) centres the element on the pointer regardless of its
//     current CSS-animated size — no JS needed to track the size value
//   • rAF loop runs only while the cursor is on-screen; stops on mouseleave,
//     snaps to entry position on mouseenter (prevents lerp-sweep re-entry glitch)
//   • Hover expansion via a single delegated `mouseover` on document —
//     no per-element listeners, handles dynamically added elements for free

(function initCursor() {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  const cursor = document.createElement('div');
  cursor.id = 'cursor';
  document.body.appendChild(cursor);

  const LERP = 0.28; // fraction of remaining distance closed per frame (~7 frames to 60%)

  let mouseX = 0, mouseY = 0; // raw pointer target (updated on mousemove)
  let curX   = 0, curY   = 0; // lerped position written to the DOM
  let rafId  = null;

  function tick() {
    curX += (mouseX - curX) * LERP;
    curY += (mouseY - curY) * LERP;
    // calc(Xpx - 50%) resolves 50% against the element's own rendered size,
    // so the cursor stays centred on the pointer during the expand/collapse transition
    cursor.style.transform = `translate(calc(${curX}px - 50%), calc(${curY}px - 50%))`;
    rafId = requestAnimationFrame(tick);
  }

  function startLoop() { if (!rafId) rafId = requestAnimationFrame(tick); }
  function stopLoop()  { cancelAnimationFrame(rafId); rafId = null; }

  // First mousemove: snap to exact position (no lerp lag on page entry),
  // reveal the cursor, then hand off to the rAF loop for subsequent frames
  let ready = false;
  document.addEventListener('mousemove', e => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!ready) {
      curX = mouseX;
      curY = mouseY;
      cursor.style.opacity = '1';
      startLoop();
      ready = true;
    }
  }, { passive: true });

  // Cursor leaves the browser window — hide and pause the loop
  document.addEventListener('mouseleave', () => {
    cursor.style.opacity = '0';
    stopLoop();
  });

  // Cursor re-enters — snap to entry coords before resuming so there's
  // no visible lerp sweep from the last position to the new one
  document.addEventListener('mouseenter', e => {
    curX = mouseX = e.clientX;
    curY = mouseY = e.clientY;
    cursor.style.opacity = '1';
    startLoop();
  });

  // Expand/collapse via event delegation — one listener handles everything:
  // nav links, footer links, buttons, work cards. closest() walks up the DOM
  // so hovering a child of .work-card (e.g. .work-thumb) still triggers it.
  const TARGETS = 'a, button, .work-card';
  document.addEventListener('mouseover', e => {
    cursor.classList.toggle('cursor--expanded', !!e.target.closest(TARGETS));
  });

})();


// ── Gradient blob ─────────────────────────────────────────────────────────────
//
// Slower lerp than the cursor (0.06 vs 0.14) gives it a heavy, floating feel.
// Same snap-on-entry pattern to avoid the visible sweep glitch on mouseenter.
// The blob is display:none on touch/mobile via CSS so this guard matches that.

(function initBlob() {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  const blob = document.createElement('div');
  blob.id = 'blob';
  document.body.appendChild(blob);

  const LERP = 0.06;

  let mouseX = 0, mouseY = 0;
  let curX   = 0, curY   = 0;
  let rafId  = null;
  let ready  = false;

  function tick() {
    curX += (mouseX - curX) * LERP;
    curY += (mouseY - curY) * LERP;
    blob.style.transform = `translate(calc(${curX}px - 50%), calc(${curY}px - 50%))`;
    rafId = requestAnimationFrame(tick);
  }

  document.addEventListener('mousemove', e => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!ready) {
      curX = mouseX;
      curY = mouseY;
      blob.style.opacity = '1';
      rafId = requestAnimationFrame(tick);
      ready = true;
    }
  }, { passive: true });

  document.addEventListener('mouseleave', () => {
    blob.style.opacity = '0';
    cancelAnimationFrame(rafId);
    rafId = null;
  });

  document.addEventListener('mouseenter', e => {
    curX = mouseX = e.clientX;
    curY = mouseY = e.clientY;
    blob.style.opacity = '1';
    if (!rafId) rafId = requestAnimationFrame(tick);
  });
})();


if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {

  const MAX_TILT   = 5;     // maximum rotation in degrees
  const LERP_IN    = 0.10;  // interpolation factor while cursor is inside
  const LERP_OUT   = 0.08;  // interpolation factor while returning to rest
  const SETTLE_EPS = 0.05;  // degrees — snap to exact zero below this

  const tiltCards = [...document.querySelectorAll('.work-card')];

  // Per-card mutable state — no DOM reads inside the loop
  const tiltState = tiltCards.map(() => ({
    rx: 0, ry: 0, ly: 0,        // current lerped values
    txRx: 0, txRy: 0, txLy: 0,  // targets set by mouse events
    hovered: false,
  }));

  let tiltRafId = null;

  function tiltLoop() {
    let anyUnsettled = false;

    tiltCards.forEach((card, i) => {
      const s   = tiltState[i];
      const lr  = s.hovered ? LERP_IN : LERP_OUT;

      // Lerp all three axes toward their targets
      s.rx += (s.txRx - s.rx) * lr;
      s.ry += (s.txRy - s.ry) * lr;
      s.ly += (s.txLy - s.ly) * lr;

      const settled =
        !s.hovered &&
        Math.abs(s.txRx - s.rx) < SETTLE_EPS &&
        Math.abs(s.txRy - s.ry) < SETTLE_EPS &&
        Math.abs(s.txLy - s.ly) < SETTLE_EPS;

      if (settled) {
        // Snap clean, hand transform back to CSS, restore transition
        s.rx = s.ry = s.ly = 0;
        card.style.removeProperty('transform');
        card.style.removeProperty('transition');
      } else {
        anyUnsettled = true;
        // perspective() per-element keeps each card's vanishing point
        // centred on itself rather than a shared parent point
        card.style.transform =
          `perspective(900px) rotateX(${s.rx}deg) rotateY(${s.ry}deg) translateY(${s.ly}px)`;
      }
    });

    tiltRafId = anyUnsettled ? requestAnimationFrame(tiltLoop) : null;
  }

  function ensureLooping() {
    if (!tiltRafId) tiltRafId = requestAnimationFrame(tiltLoop);
  }

  tiltCards.forEach((card, i) => {
    const s = tiltState[i];

    card.addEventListener('mouseenter', () => {
      s.hovered = true;
      s.txLy    = -10; // replaces CSS :hover translateY(-10px)
      // Kill CSS transition so it doesn't slow-fight the lerp
      card.style.transition = 'none';
      ensureLooping();
    });

    card.addEventListener('mousemove', e => {
      const r  = card.getBoundingClientRect();
      // Normalise to –0.5 … +0.5 from card centre
      const cx = (e.clientX - r.left) / r.width  - 0.5;
      const cy = (e.clientY - r.top)  / r.height - 0.5;

      // rotateX: cursor above centre (cy < 0) → top tilts toward viewer → negative X rotation
      // rotateY: cursor right of centre (cx > 0) → right tilts toward viewer → negative Y rotation
      // (CSS 3D axes: +Y points down, so right-hand rule flips the Y sign)
      s.txRx =  cy * 2 * MAX_TILT;
      s.txRy = -cx * 2 * MAX_TILT;
    });

    card.addEventListener('mouseleave', () => {
      s.hovered = false;
      s.txRx    = 0;
      s.txRy    = 0;
      s.txLy    = 0;
      ensureLooping(); // keep loop running until lerp settles
    });
  });

}


// ── Stats count-up ────────────────────────────────────────────────────────────
//
// Each .stat-number has data-target (integer) and data-suffix (e.g. "+").
// easeOutCubic: fast start, decelerates into the final value — feels snappy
// but not mechanical. Falls back to instant display on reduced-motion.

const statsEl = document.querySelector('.stats');

if (statsEl) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const statsObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      statsObserver.unobserve(entry.target);

      entry.target.querySelectorAll('.stat-number').forEach(el => {
        const target   = parseInt(el.dataset.target, 10);
        const suffix   = el.dataset.suffix ?? '';
        const duration = 2000; // ms

        if (reducedMotion) {
          el.textContent = target + suffix;
          return;
        }

        const startTime = performance.now();

        function tick(now) {
          const elapsed  = now - startTime;
          const progress = Math.min(elapsed / duration, 1);
          // ease-out cubic: decelerates toward the end
          const eased    = 1 - Math.pow(1 - progress, 3);
          el.textContent = Math.round(eased * target) + suffix;
          if (progress < 1) requestAnimationFrame(tick);
        }

        requestAnimationFrame(tick);
      });
    });
  }, { threshold: 0.5 });

  statsObserver.observe(statsEl);
}


// ── Floating CTA bar ──────────────────────────────────────────────────────────
//
// Shows after scrolling past the hero. Hides when the contact section is
// visible. Dismissed state is stored in sessionStorage so it stays gone
// for the rest of the session but reappears on a fresh visit.

(function () {
  const bar        = document.getElementById('ctaBar');
  const closeBtn   = document.getElementById('ctaBarClose');
  const hero       = document.querySelector('.hero');
  const contact    = document.querySelector('.contact');
  if (!bar || !hero || !contact) return;

  // Already dismissed this session — hide permanently
  if (sessionStorage.getItem('ctaBarDismissed')) {
    bar.classList.add('hidden');
    return;
  }

  let heroBottom    = 0;
  let contactTop    = 0;
  let ticking       = false;

  function measure() {
    heroBottom   = hero.getBoundingClientRect().bottom  + window.scrollY;
    contactTop   = contact.getBoundingClientRect().top  + window.scrollY;
  }

  function update() {
    const sy = window.scrollY;
    const inContactZone = sy + window.innerHeight * 0.6 >= contactTop;
    const pastHero      = sy > heroBottom - 120;
    if (pastHero && !inContactZone) {
      bar.classList.add('visible');
    } else {
      bar.classList.remove('visible');
    }
    ticking = false;
  }

  measure();
  window.addEventListener('scroll', () => {
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }, { passive: true });
  window.addEventListener('resize', measure, { passive: true });

  closeBtn.addEventListener('click', () => {
    bar.classList.remove('visible');
    sessionStorage.setItem('ctaBarDismissed', '1');
    // After slide-out, hide completely so it doesn't intercept pointer events
    bar.addEventListener('transitionend', () => bar.classList.add('hidden'), { once: true });
  });

  // Also hide when user clicks the CTA button (they're going to contact)
  bar.querySelector('.cta-bar-btn').addEventListener('click', () => {
    bar.classList.remove('visible');
  });
})();


// ── FAQ Accordion ─────────────────────────────────────────────────────────────

document.querySelectorAll('.faq-question').forEach(btn => {
  btn.addEventListener('click', () => {
    const item   = btn.closest('.faq-item');
    const answer = item.querySelector('.faq-answer');
    const isOpen = item.classList.contains('open');

    // Close all open items
    document.querySelectorAll('.faq-item.open').forEach(openItem => {
      openItem.classList.remove('open');
      openItem.querySelector('.faq-answer').style.maxHeight = '0';
      openItem.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
    });

    // Open clicked if it was closed
    if (!isOpen) {
      item.classList.add('open');
      answer.style.maxHeight = answer.scrollHeight + 'px';
      btn.setAttribute('aria-expanded', 'true');
    }
  });
});


// ── Back to top ───────────────────────────────────────────────────────────────
//
// Uses lenis.scrollTo(0) when available so the scroll has Lenis momentum.
// Falls back to native smooth scroll for environments without Lenis.

const topBtn = document.querySelector('.footer-top-btn');
if (topBtn) {
  topBtn.addEventListener('click', () => {
    if (typeof lenis !== 'undefined') {
      lenis.scrollTo(0, { duration: 0.9, easing: t => 1 - Math.pow(1 - t, 4) });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}


// ── Project overlay ───────────────────────────────────────────────────────────
//
// Each .work-card carries its project data in data-project-* attributes.
// openOverlay() reads those, populates the overlay, then slides it up.
// The iframe src is set 100ms after open starts so the slide animation
// is already in motion before the network request fires.
// closeOverlay() slides it down and clears the iframe src once the
// animation completes — stops the embedded page from running in the background.

(function initProjectOverlay() {
  const overlay  = document.getElementById('project-overlay');
  if (!overlay) return;

  const iframe   = document.getElementById('project-iframe');
  const urlEl    = overlay.querySelector('.overlay-url');
  const tagEl    = overlay.querySelector('.overlay-tag');
  const titleEl  = overlay.querySelector('.overlay-title');
  const descEl   = overlay.querySelector('.overlay-desc');
  const visitBtn = overlay.querySelector('.overlay-visit');
  const closeBtn = overlay.querySelector('.overlay-close');
  const xBtn     = overlay.querySelector('.overlay-x');

  function openOverlay(card) {
    const url      = card.dataset.projectUrl      || '';
    const name     = card.dataset.projectName     || '';
    const category = card.dataset.projectCategory || '';
    const desc     = card.dataset.projectDesc     || '';
    const live     = card.dataset.projectLive     || '';

    // Populate
    urlEl.textContent   = url;
    tagEl.textContent   = category;
    titleEl.textContent = name;
    descEl.textContent  = desc;

    if (live) {
      visitBtn.href = live;
      visitBtn.hidden = false;
    } else {
      visitBtn.hidden = true;
    }

    // Slide up
    overlay.classList.add('is-open');
    overlay.querySelector('.overlay-inner').scrollTop = 0;

    // Freeze page scroll behind the overlay
    if (typeof lenis !== 'undefined') lenis.stop();

    // Set iframe src after animation is underway
    setTimeout(() => { iframe.src = url; }, 100);

    // Move focus into overlay for keyboard users
    overlay.focus();
  }

  function closeOverlay() {
    overlay.classList.remove('is-open');

    // Restore page scroll
    if (typeof lenis !== 'undefined') lenis.start();

    // Clear iframe after slide-down completes (700ms) to stop the page running
    setTimeout(() => {
      iframe.src = '';
      urlEl.textContent = '';
    }, 720);
  }

  // Open on work card click
  document.querySelectorAll('.work-card[data-project-url]').forEach(card => {
    card.addEventListener('click', () => openOverlay(card));
  });

  // Close via both buttons
  closeBtn.addEventListener('click', closeOverlay);
  xBtn.addEventListener('click', closeOverlay);

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('is-open')) closeOverlay();
  });

  // Click on the overlay backdrop itself (not its children) also closes
  overlay.addEventListener('pointerdown', e => {
    if (e.target === overlay) closeOverlay();
  });
})();


// ── Contact form ───────────────────────────────────────────────────────────────
//
// Sends form data to Formspree via fetch so we can handle the response in JS.
// On success, hides the form and shows the success message.
// On network or server error, re-enables the button and surfaces the error.

(function initContactForm() {
  const form       = document.querySelector('.contact-form');
  const successEl  = document.querySelector('.contact-success');
  if (!form || !successEl) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();

    const btn = form.querySelector('.contact-btn');
    btn.disabled    = true;
    btn.textContent = 'Sending…';

    try {
      const res = await fetch(form.action, {
        method:  'POST',
        headers: { 'Accept': 'application/json' },
        body:    new FormData(form),
      });

      if (res.ok) {
        form.hidden        = true;
        successEl.hidden   = false;
      } else {
        const data = await res.json().catch(() => ({}));
        const msg  = data?.errors?.map(err => err.message).join(', ')
                     || 'Something went wrong. Please try again.';
        alert(msg);
        btn.disabled    = false;
        btn.textContent = 'Send Message';
      }
    } catch {
      alert('Network error — please check your connection and try again.');
      btn.disabled    = false;
      btn.textContent = 'Send Message';
    }
  });
})();


// ── Wireframe sphere ───────────────────────────────────────────────────────────
//
// Renders a rotating wireframe sphere on a <canvas> using a simple orthographic
// projection. 7 latitude rings + 9 meridian great-circles = 16 rings total.
// Each line segment is opacity-faded by depth (z), so the back hemisphere is
// ghostlike (~4% opacity) and the front face glows (~15% opacity).
// Two-axis rotation: Y fast (~0.0025 rad/frame), X slow (~0.0008 rad/frame).

(function initSphere() {
  const canvas = document.getElementById('sphere-canvas');
  if (!canvas) return;

  // Respect the OS reduced-motion preference — skip animation entirely
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const ctx = canvas.getContext('2d');
  let W, H, cx, cy, R, dpr;

  function resize() {
    dpr           = window.devicePixelRatio || 1;
    W             = canvas.offsetWidth;
    H             = canvas.offsetHeight;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    cx            = W / 2;
    cy            = H / 2;
    R             = Math.min(W, H) * 0.33;
  }

  window.addEventListener('resize', resize);
  resize();

  // ── Rotation state ─────────────────────────────────────────────────────────
  let rotX = 0.28;   // initial tilt so the sphere isn't head-on
  let rotY = 0;

  // Rotate a 3D point around Y then X axes
  function rotate(x, y, z) {
    const x1 =  x * Math.cos(rotY) - z * Math.sin(rotY);
    const z1 =  x * Math.sin(rotY) + z * Math.cos(rotY);
    const y2 =  y * Math.cos(rotX) - z1 * Math.sin(rotX);
    const z2 =  y * Math.sin(rotX) + z1 * Math.cos(rotX);
    return [x1, y2, z2];
  }

  // ── Build rings as unit-radius point arrays ─────────────────────────────────
  const SEG = 72;

  function buildLatRing(lat) {
    const cosL = Math.cos(lat), sinL = Math.sin(lat);
    const pts  = [];
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      pts.push([cosL * Math.cos(a), sinL, cosL * Math.sin(a)]);
    }
    return pts;
  }

  function buildMeridianRing(lon) {
    const pts = [];
    for (let i = 0; i <= SEG; i++) {
      const t = (i / SEG) * Math.PI * 2;
      pts.push([
        Math.sin(t) * Math.cos(lon),
        Math.cos(t),
        Math.sin(t) * Math.sin(lon),
      ]);
    }
    return pts;
  }

  const rings = [
    ...[-70, -50, -30, 0, 30, 50, 70].map(d => buildLatRing(d * Math.PI / 180)),
    ...Array.from({ length: 9 }, (_, i) => buildMeridianRing(i * Math.PI / 9)),
  ];

  // ── Per-frame draw ──────────────────────────────────────────────────────────
  function drawRing(unitPts) {
    const n = unitPts.length - 1;
    for (let i = 0; i < n; i++) {
      const [x1, y1, z1] = rotate(
        unitPts[i][0] * R,     unitPts[i][1] * R,     unitPts[i][2] * R);
      const [x2, y2, z2] = rotate(
        unitPts[i+1][0] * R,   unitPts[i+1][1] * R,   unitPts[i+1][2] * R);

      // Average Z normalised [-1,+1] → opacity [0.04, 0.15]
      const alpha = (0.04 + ((z1 + z2) / (2 * R) + 1) * 0.5 * 0.11).toFixed(3);

      ctx.beginPath();
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.moveTo(cx + x1, cy + y1);
      ctx.lineTo(cx + x2, cy + y2);
      ctx.stroke();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 0.75;
    ctx.lineCap   = 'round';

    rings.forEach(drawRing);

    ctx.restore();

    rotY += 0.0025;
    rotX += 0.0008;

    requestAnimationFrame(draw);
  }

  draw();
})();
