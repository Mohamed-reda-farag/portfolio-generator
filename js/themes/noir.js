/**
 * noir.js — Noir Theme Effects
 * Exposed as: window.NoirFX
 *
 * Effects:
 *  1. Black band injection (status bar above hero)
 *  2. Hero name red slash — splits first word / rest
 *  3. Custom crosshair cursor with red accent dot
 *  4. Magnetic card tilt (3D perspective on mousemove)
 *  5. Card spotlight — radial red glow follows cursor inside card
 *  6. Scroll-triggered section reveals (clip-path wipe)
 *  7. Live clock in band
 *  8. MutationObserver — applies effects to new cards
 */

(function () {
  'use strict';

  let _active = false;
  let _timeouts  = [];
  let _listeners = [];
  let _observers = [];
  let _rafId     = null;
  let _clockId   = null;

  /* ── Helpers ── */
  function _t(fn, ms)  { const id = setTimeout(fn, ms); _timeouts.push(id); return id; }
  function _on(el, ev, fn, opts) {
    el.addEventListener(ev, fn, opts);
    _listeners.push({ el, ev, fn, opts });
  }
  function _isActive() {
    return document.body.getAttribute('data-theme') === 'noir'
        || document.documentElement.getAttribute('data-theme') === 'noir';
  }

  /* ══════════════════════════════════════════════════════
     1. BLACK BAND — status bar above hero
  ══════════════════════════════════════════════════════ */
  function initBand() {
    if (document.querySelector('.nr-band')) return;

    const repoCount  = document.querySelectorAll('.project-card').length || 6;
    const skillCount = document.querySelectorAll('.skill-tag:not(.skill-tag--add)').length || 12;

    const band = document.createElement('div');
    band.className = 'nr-band';
    band.setAttribute('aria-hidden', 'true');
    band.innerHTML = `
      <div class="nr-band__left">
        <span class="nr-band__dot"></span>
        <span>${repoCount} projects</span>
        <span>·</span>
        <span>${skillCount} skills</span>
        <span>·</span>
        <span>Available</span>
      </div>
      <div class="nr-band__right" id="nr-clock"></div>
    `;

    const toolbar  = document.getElementById('edit-toolbar');
    const container = document.querySelector('.portfolio-container, .portfolio-wrapper');

    if (toolbar && toolbar.nextSibling) {
      toolbar.parentNode.insertBefore(band, toolbar.nextSibling);
    } else if (container) {
      container.parentNode.insertBefore(band, container);
    }

    /* Live clock */
    function updateClock() {
      const el = document.getElementById('nr-clock');
      if (!el || !_active) return;
      const now = new Date();
      const hh  = String(now.getHours()).padStart(2, '0');
      const mm  = String(now.getMinutes()).padStart(2, '0');
      const ss  = String(now.getSeconds()).padStart(2, '0');
      el.textContent = `${hh}:${mm}:${ss}`;
    }
    updateClock();
    _clockId = setInterval(updateClock, 1000);
  }

  /* ══════════════════════════════════════════════════════
     2. HERO NAME — red slash between first / last name
  ══════════════════════════════════════════════════════ */
  function initHeroName() {
    const nameEl = document.querySelector('.portfolio-hero__name');
    if (!nameEl || nameEl.dataset.nrSplit) return;
    nameEl.dataset.nrSplit = '1';

    const text  = nameEl.textContent.trim();
    const words = text.split(/\s+/);
    if (words.length < 2) return;

    /* First name / slash / rest */
    const first = words[0];
    const rest  = words.slice(1).join(' ');

    nameEl.innerHTML =
      `${first}<span class="nr-slash"> / </span>${rest}`;
  }

  /* ══════════════════════════════════════════════════════
     3. CUSTOM CURSOR — crosshair with red dot
  ══════════════════════════════════════════════════════ */
  function initCursor() {
    if (window.matchMedia('(pointer: coarse)').matches) return;

    /* Outer ring */
    const ring = document.createElement('div');
    ring.id = 'nr-cursor-ring';
    ring.style.cssText = `
      position: fixed; pointer-events: none; z-index: 99999;
      width: 36px; height: 36px;
      border: 1.5px solid #000000;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      transition: width 0.25s cubic-bezier(0.16,1,0.3,1),
                  height 0.25s cubic-bezier(0.16,1,0.3,1),
                  border-color 0.2s, opacity 0.2s;
      opacity: 0;
    `;

    /* Red dot center */
    const dot = document.createElement('div');
    dot.id = 'nr-cursor-dot';
    dot.style.cssText = `
      position: fixed; pointer-events: none; z-index: 100000;
      width: 6px; height: 6px;
      background: #E8000D;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      transition: width 0.18s, height 0.18s, opacity 0.18s;
      opacity: 0;
    `;

    document.body.appendChild(ring);
    document.body.appendChild(dot);
    document.body.classList.add('nr-cursor-active');

    let mx = 0, my = 0;
    let rx = 0, ry = 0;

    _on(document, 'mousemove', (e) => {
      mx = e.clientX; my = e.clientY;
      dot.style.left  = mx + 'px';
      dot.style.top   = my + 'px';
      dot.style.opacity = '1';
      ring.style.opacity = '1';
    }, { passive: true });

    _on(document, 'mouseleave', () => {
      dot.style.opacity  = '0';
      ring.style.opacity = '0';
    });

    /* Ring follows with lag */
    ;(function followRing() {
      if (!_active) return;
      rx += (mx - rx) * 0.14;
      ry += (my - ry) * 0.14;
      ring.style.left = rx + 'px';
      ring.style.top  = ry + 'px';
      requestAnimationFrame(followRing);
    })();

    /* Hover states */
    _on(document, 'mouseover', (e) => {
      const el = e.target;
      if (el.matches('button, a, .project-card, .skill-tag, [contenteditable]')) {
        ring.style.width        = '52px';
        ring.style.height       = '52px';
        ring.style.borderColor  = '#E8000D';
        dot.style.width         = '8px';
        dot.style.height        = '8px';
      } else {
        ring.style.width        = '36px';
        ring.style.height       = '36px';
        ring.style.borderColor  = '#000000';
        dot.style.width         = '6px';
        dot.style.height        = '6px';
      }
    });
  }

  /* ══════════════════════════════════════════════════════
     4 + 5. MAGNETIC TILT + SPOTLIGHT on cards
  ══════════════════════════════════════════════════════ */
  function applyCardEffects(card) {
    if (card.dataset.nrCard) return;
    card.dataset.nrCard = '1';

    /* --- mousemove inside card --- */
    function onMove(e) {
      if (!_active) return;
      const rect  = card.getBoundingClientRect();
      const cx    = rect.left + rect.width  / 2;
      const cy    = rect.top  + rect.height / 2;
      const dx    = (e.clientX - cx) / (rect.width  / 2);   /* -1 → +1 */
      const dy    = (e.clientY - cy) / (rect.height / 2);

      /* Tilt — subtle, max 6deg */
      const tiltX =  dy * 6;
      const tiltY = -dx * 6;

      card.style.transform = `perspective(600px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) translateZ(6px)`;
      card.style.transition = 'transform 0.08s linear, box-shadow 0.08s linear';
      card.style.boxShadow  = `${-dx * 8}px ${-dy * 8}px 24px rgba(0,0,0,0.12)`;

      /* Spotlight — set CSS custom props */
      const mx = ((e.clientX - rect.left) / rect.width)  * 100;
      const my = ((e.clientY - rect.top)  / rect.height) * 100;
      card.style.setProperty('--nr-mx', `${mx}%`);
      card.style.setProperty('--nr-my', `${my}%`);
    }

    function onLeave() {
      card.style.transition = 'transform 0.55s cubic-bezier(0.16,1,0.3,1), box-shadow 0.55s';
      card.style.transform  = '';
      card.style.boxShadow  = '';
    }

    card.addEventListener('mousemove',  onMove);
    card.addEventListener('mouseleave', onLeave);
    /* stored for cleanup */
    _listeners.push({ el: card, ev: 'mousemove',  fn: onMove  });
    _listeners.push({ el: card, ev: 'mouseleave', fn: onLeave });
  }

  function initCardEffects() {
    document.querySelectorAll('.project-card').forEach(applyCardEffects);
  }

  /* ══════════════════════════════════════════════════════
     6. SCROLL REVEALS — clip-path wipe bottom → top
  ══════════════════════════════════════════════════════ */
  function initReveal() {
    const style = document.createElement('style');
    style.id = 'nr-reveal-style';
    style.textContent = `
      [data-theme="noir"] .project-card,
      .theme-noir .project-card {
        clip-path: inset(100% 0 0 0);
        transition: clip-path 0.65s cubic-bezier(0.16,1,0.3,1);
      }
      [data-theme="noir"] .project-card.nr-revealed,
      .theme-noir .project-card.nr-revealed {
        clip-path: inset(0% 0 0 0);
      }
      [data-theme="noir"] .section-label,
      .theme-noir .section-label {
        opacity: 0; transform: translateX(-16px);
        transition: opacity 0.5s ease, transform 0.5s cubic-bezier(0.16,1,0.3,1);
      }
      [data-theme="noir"] .section-label.nr-revealed,
      .theme-noir .section-label.nr-revealed {
        opacity: 1; transform: translateX(0);
      }
    `;
    document.head.appendChild(style);

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el  = entry.target;
        const all = [...document.querySelectorAll('.project-card')];
        const idx = all.indexOf(el);
        const delay = el.classList.contains('project-card')
          ? (idx % 3) * 90
          : 0;
        setTimeout(() => el.classList.add('nr-revealed'), delay);
        observer.unobserve(el);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -32px 0px' });

    document.querySelectorAll('.project-card, .section-label')
      .forEach(el => observer.observe(el));

    _observers.push(observer);
  }

  /* ══════════════════════════════════════════════════════
     7. SKILL TAG — stagger fade in
  ══════════════════════════════════════════════════════ */
  function initSkillReveal() {
    const style = document.getElementById('nr-skill-style') || document.createElement('style');
    style.id = 'nr-skill-style';
    style.textContent = `
      [data-theme="noir"] .skill-tag:not(.skill-tag--add),
      .theme-noir .skill-tag:not(.skill-tag--add) {
        opacity: 0; transform: translateY(8px);
        transition: opacity 0.4s ease, transform 0.4s cubic-bezier(0.16,1,0.3,1);
      }
      [data-theme="noir"] .skill-tag.nr-revealed,
      .theme-noir .skill-tag.nr-revealed {
        opacity: 1; transform: translateY(0);
      }
    `;
    document.head.appendChild(style);

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const tags = [...document.querySelectorAll('.skill-tag:not(.skill-tag--add)')];
        tags.forEach((tag, i) => {
          setTimeout(() => tag.classList.add('nr-revealed'), i * 40);
        });
        obs.disconnect();
      });
    }, { threshold: 0.2 });

    const container = document.querySelector('.skills-container');
    if (container) obs.observe(container);
    _observers.push(obs);
  }

  /* ══════════════════════════════════════════════════════
     8. MUTATION OBSERVER — new cards get effects
  ══════════════════════════════════════════════════════ */
  function initMutationObserver() {
    const grid = document.querySelector('.projects-grid, [data-projects-grid]');
    if (!grid) return;

    const obs = new MutationObserver(() => {
      _t(() => { initCardEffects(); }, 60);
    });
    obs.observe(grid, { childList: true });
    _observers.push(obs);
  }

  /* ══════════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════════ */
  function init() {
    if (_active) return;
    _active = true;

    requestAnimationFrame(() => {
      initBand();
      initHeroName();
      initCursor();
      initCardEffects();
      initReveal();
      initSkillReveal();
      initMutationObserver();
    });
  }

  function destroy() {
    if (!_active) return;
    _active = false;

    /* Timers */
    _timeouts.forEach(clearTimeout);
    _timeouts = [];
    if (_clockId) { clearInterval(_clockId); _clockId = null; }
    if (_rafId)   { cancelAnimationFrame(_rafId); _rafId = null; }

    /* Event listeners */
    _listeners.forEach(({ el, ev, fn, opts }) => el.removeEventListener(ev, fn, opts));
    _listeners = [];

    /* Observers */
    _observers.forEach(o => o.disconnect?.());
    _observers = [];

    /* DOM cleanup */
    document.querySelector('.nr-band')?.remove();
    document.getElementById('nr-cursor-ring')?.remove();
    document.getElementById('nr-cursor-dot')?.remove();
    document.getElementById('nr-reveal-style')?.remove();
    document.getElementById('nr-skill-style')?.remove();
    document.body.classList.remove('nr-cursor-active');

    /* Reset hero name */
    const nameEl = document.querySelector('.portfolio-hero__name');
    if (nameEl && nameEl.dataset.nrSplit) {
      nameEl.textContent = nameEl.textContent.replace(' / ', ' ').trim();
      delete nameEl.dataset.nrSplit;
    }

    /* Reset cards */
    document.querySelectorAll('.project-card').forEach(card => {
      card.classList.remove('nr-revealed');
      card.style.transform   = '';
      card.style.boxShadow   = '';
      card.style.clipPath    = '';
      card.style.transition  = '';
      delete card.dataset.nrCard;
    });

    /* Reset skills */
    document.querySelectorAll('.skill-tag').forEach(t => {
      t.classList.remove('nr-revealed');
      t.style.opacity   = '';
      t.style.transform = '';
    });

    /* Reset section labels */
    document.querySelectorAll('.section-label').forEach(el => {
      el.classList.remove('nr-revealed');
      el.style.opacity   = '';
      el.style.transform = '';
    });
  }

  window.NoirFX = { init, destroy };

})();
