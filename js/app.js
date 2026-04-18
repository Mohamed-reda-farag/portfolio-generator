/**
 * app.js — Portfolio Generator
 * Main entry: GSAP animations · scroll effects · global utilities
 *
 * Dependencies: GSAP + ScrollTrigger (loaded via CDN in HTML)
 */

/* ─────────────────────────────────────────────────────────────────
   GLOBAL UTILITIES
   [FIX] معرّفة هنا في الأعلى — قبل أي event listener —
   عشان تكون متاحة فور تحميل الملف حتى لو GSAP اتأخر
───────────────────────────────────────────────────────────────── */

/**
 * Debounce a function call
 * @param {Function} fn
 * @param {number} delay ms
 */
window.debounce = function(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

/**
 * Format a number with K/M suffix
 * @param {number} n
 * @returns {string}
 */
window.formatNum = function(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
};

/**
 * Sanitize a string for safe HTML injection
 * @param {string} str
 * @returns {string}
 */
window.sanitize = function(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

/**
 * Get a value from sessionStorage safely
 * @param {string} key
 * @param {*} fallback
 */
window.getSession = function(key, fallback = null) {
  try {
    return sessionStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

/**
 * Set a value in sessionStorage safely
 * @param {string} key
 * @param {string} value
 */
window.setSession = function(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    console.warn(`sessionStorage.setItem failed for key: ${key}`);
  }
};

/**
 * Sleep (async/await helper)
 * @param {number} ms
 */
window.sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/* ─────────────────────────────────────────────────────────────────
   TOAST NOTIFICATION SYSTEM
   [FIX] معرّفة قبل window.load عشان تكون متاحة فوراً
   Usage: window.toast('Message', 'success' | 'error' | 'warn')
───────────────────────────────────────────────────────────────── */
(function initToastEarly() {
  const icons = {
    success: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warn:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  };

  const colors = {
    success: 'var(--clr-accent)',
    error:   'var(--clr-error)',
    warn:    'var(--clr-warn)',
  };

  window.toast = function(message, type = 'success', duration = 4000) {
    // لو الـ container مش موجود بعد (DOMContentLoaded لسه ما اشتغلش)، انتظر
    const container = document.getElementById('toast-container');
    if (!container) {
      document.addEventListener('DOMContentLoaded', () => {
        window.toast(message, type, duration);
      }, { once: true });
      return;
    }

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', 'status');

    toast.innerHTML = `
      <span style="color:${colors[type] || colors.success}; flex-shrink:0;">${icons[type] || ''}</span>
      <span>${message}</span>
    `;

    container.appendChild(toast);

    // Auto dismiss
    setTimeout(() => {
      toast.classList.add('is-leaving');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, duration);

    return toast;
  };
})();

/* ── Wait for GSAP to load ─────────────────────────────────────── */
window.addEventListener('load', () => {
  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') {
    console.warn('GSAP not loaded — animations skipped');
    // Fallback: make everything visible
    document.querySelectorAll('[data-anim]').forEach(el => {
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
    return;
  }

  // Register ScrollTrigger plugin
  gsap.registerPlugin(ScrollTrigger);

  initAnimations();
  initScrollEffects();
});

/* ─────────────────────────────────────────────────────────────────
   ANIMATIONS
───────────────────────────────────────────────────────────────── */
function initAnimations() {

  /* ── Hero stagger (above the fold — no scroll trigger) ──── */
  const heroTl = gsap.timeline({ defaults: { ease: 'power3.out' } });

  // [FIX] selector واضح ومحدد بدل :first-of-type الهش
  heroTl.to('.hero__eyebrow', {
    opacity: 1,
    duration: 0.6,
    delay: 0.1,
  });

  // Main title
  const heroTitle = document.querySelector('.hero__title');
  if (heroTitle) {
    heroTl.to('.hero__title', {
      opacity: 1,
      y: 0,
      duration: 0.8,
      delay: 0.05,
    }, '<0.1');
  }

  // Sub, timer, stats
  heroTl
    .to('.hero__sub',   { opacity: 1, y: 0, duration: 0.7 }, '<0.15')
    .to('.hero__timer', { opacity: 1, duration: 0.5 }, '<0.1')
    .to('.stats-strip', { opacity: 1, y: 0, duration: 0.7 }, '<0.1');

  // Hero form card — slides in from right
  heroTl.to('.hero-form-card', {
    opacity: 1,
    scale: 1,
    duration: 0.9,
    ease: 'back.out(1.2)',
  }, '<-0.5');

  /* ── Scroll-triggered sections ──────────────────────────── */

  // Generic [data-anim] elements (default: fade up)
  gsap.utils.toArray('[data-anim]:not(.hero__title):not(.hero__sub):not(.hero__timer):not(.stats-strip):not(.hero-form-card):not(.hero__eyebrow)').forEach(el => {
    const animType = el.getAttribute('data-anim');

    let fromVars = { opacity: 0, y: 24 };
    if (animType === 'fade')  fromVars = { opacity: 0, y: 0 };
    if (animType === 'left')  fromVars = { opacity: 0, x: -30 };
    if (animType === 'right') fromVars = { opacity: 0, x: 30 };
    if (animType === 'scale') fromVars = { opacity: 0, scale: 0.92 };

    const toVars = { opacity: 1, y: 0, x: 0, scale: 1, duration: 0.7, ease: 'power2.out' };

    ScrollTrigger.create({
      trigger: el,
      start: 'top 88%',
      onEnter: () => gsap.fromTo(el, fromVars, toVars),
      once: true,
    });
  });

  /* ── Steps — staggered ──────────────────────────────────── */
  const steps = document.querySelectorAll('.step-card');
  if (steps.length) {
    ScrollTrigger.create({
      trigger: '.steps-grid',
      start: 'top 80%',
      onEnter: () => {
        gsap.fromTo(steps,
          { opacity: 0, y: 40 },
          { opacity: 1, y: 0, duration: 0.6, stagger: 0.15, ease: 'power2.out' }
        );
      },
      once: true,
    });
  }

  /* ── Theme cards — staggered ────────────────────────────── */
  const themeCards = document.querySelectorAll('.theme-card');
  if (themeCards.length) {
    ScrollTrigger.create({
      trigger: '.themes-grid',
      start: 'top 82%',
      onEnter: () => {
        gsap.fromTo(themeCards,
          { opacity: 0, y: 30, scale: 0.95 },
          { opacity: 1, y: 0, scale: 1, duration: 0.55, stagger: 0.08, ease: 'back.out(1.1)' }
        );
      },
      once: true,
    });
  }

  /* ── Proof cards — staggered ────────────────────────────── */
  const proofCards = document.querySelectorAll('.proof-card');
  if (proofCards.length) {
    ScrollTrigger.create({
      trigger: '.proof-grid',
      start: 'top 82%',
      onEnter: () => {
        gsap.fromTo(proofCards,
          { opacity: 0, y: 30 },
          { opacity: 1, y: 0, duration: 0.6, stagger: 0.12, ease: 'power2.out' }
        );
      },
      once: true,
    });
  }

  /* ── Stat counters — animate numbers ───────────────────── */
  const statValues = document.querySelectorAll('.stat-item__value');
  if (statValues.length) {
    ScrollTrigger.create({
      trigger: '.stats-strip',
      start: 'top 90%',
      onEnter: () => {
        statValues.forEach(el => {
          const text = el.textContent.trim();
          const numMatch = text.match(/[\d.]+/);
          if (!numMatch) return;

          const finalNum = parseFloat(numMatch[0]);

          // [FIX] منطق بسيط وواضح: نحفظ الـ suffix (كل اللي بعد الرقم)
          // ونحتفظ بالـ span الداخلي لو موجود
          const innerSpan  = el.querySelector('span');
          const spanText   = innerSpan?.textContent || '';
          // الـ suffix = الجزء بعد الرقم في النص الكامل بدون الـ span
          const rawSuffix  = text.replace(spanText, '').replace(numMatch[0], '').trim();

          const counter = { val: 0 };
          gsap.to(counter, {
            val: finalNum,
            duration: 1.5,
            delay: 0.3,
            ease: 'power2.out',
            onUpdate: () => {
              const display = Number.isInteger(finalNum)
                ? Math.round(counter.val)
                : counter.val.toFixed(1);
              // [FIX] بناء واضح: رقم + suffix + span لو موجود
              el.innerHTML = display + rawSuffix +
                (spanText ? `<span>${spanText}</span>` : '');
            },
          });
        });
      },
      once: true,
    });
  }
}

/* ─────────────────────────────────────────────────────────────────
   SCROLL EFFECTS
───────────────────────────────────────────────────────────────── */
function initScrollEffects() {

  /* ── Parallax on hero eyebrow & badge ───────────────────── */
  const heroEyebrow = document.querySelector('.hero__eyebrow');
  if (heroEyebrow) {
    gsap.to(heroEyebrow, {
      y: -30,
      ease: 'none',
      scrollTrigger: {
        trigger: '.hero',
        start: 'top top',
        end: 'bottom top',
        scrub: 1,
      },
    });
  }

  /* ── Marquee speed up on scroll ─────────────────────────── */
  const marqueeTrack = document.getElementById('marquee-track');
  if (marqueeTrack) {
    ScrollTrigger.create({
      trigger: '.marquee-section',
      start: 'top bottom',
      end: 'bottom top',
      onEnter:      () => marqueeTrack.style.animationDuration = '20s',
      onLeave:      () => marqueeTrack.style.animationDuration = '30s',
      onEnterBack:  () => marqueeTrack.style.animationDuration = '20s',
      onLeaveBack:  () => marqueeTrack.style.animationDuration = '30s',
    });
  }
}