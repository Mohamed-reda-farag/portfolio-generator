/**
 * editorial.js — Editorial Theme Effects
 *
 * Effects:
 *  1. Ticker marquee injection (scrolling stats bar like nikolaradeski.com)
 *  2. Issue/page numbers on project cards (01, 02, 03...)
 *  3. Custom ink-drop cursor on desktop
 *  4. Reveal animation — cards wipe in from bottom on load
 *  5. Hero name letter-spacing breathe on scroll
 *  6. MutationObserver — applies to newly added cards
 *
 * CSS-only fallback: ticker and numbering still visible
 * without this JS, theme looks great either way.
 */

(function () {
  'use strict';

  let _active = false;
  let _timeouts = [];
  let _observers = [];
  let _rafId = null;
  let _scrollY = 0;

  function _setTimeout(fn, delay) {
    const id = setTimeout(fn, delay);
    _timeouts.push(id);
    return id;
  }

  function _isActive() {
    return (
      document.body.getAttribute('data-theme') === 'editorial' ||
      document.documentElement.getAttribute('data-theme') === 'editorial'
    );
  }

  /* ── 1. TICKER MARQUEE ─────────────────────────────────────
     Injects a scrolling stats bar right below the toolbar.
     Pulls live data from the draft if available.
  ─────────────────────────────────────────────────────────── */
  function initTicker() {
    if (document.querySelector('.ed-ticker')) return;

    // Pull stats from draft / DOM
    const repoCount  = document.querySelectorAll('.project-card').length || 6;
    const skillCount = document.querySelectorAll('.skill-tag:not(.skill-tag--add)').length || 12;
    const nameEl     = document.querySelector('.portfolio-hero__name');
    const name       = nameEl?.textContent?.trim() || 'Developer';
    const year       = new Date().getFullYear();

    const items = [
      `${name}`,
      `${repoCount} open source projects`,
      `${skillCount} skills`,
      `Available for hire`,
      `${year}`,
      `Portfolio`,
      `${name}`,
      `${repoCount} open source projects`,
      `${skillCount} skills`,
      `Available for hire`,
      `${year}`,
      `Portfolio`,
    ];

    const ticker = document.createElement('div');
    ticker.className = 'ed-ticker';
    ticker.setAttribute('aria-hidden', 'true');

    const track = document.createElement('div');
    track.className = 'ed-ticker__track';

    items.forEach(text => {
      const item = document.createElement('span');
      item.className = 'ed-ticker__item';
      item.textContent = text;
      track.appendChild(item);
    });

    ticker.appendChild(track);

    // Insert after toolbar, before portfolio content
    const toolbar = document.getElementById('edit-toolbar');
    const container = document.querySelector('.portfolio-container, .portfolio-wrapper');

    if (toolbar && toolbar.nextSibling) {
      toolbar.parentNode.insertBefore(ticker, toolbar.nextSibling);
    } else if (container) {
      container.parentNode.insertBefore(ticker, container);
    }
  }

  /* ── 2. ISSUE NUMBERS ON CARDS ─────────────────────────────
     Adds 01, 02, 03... like magazine issue numbers.
  ─────────────────────────────────────────────────────────── */
  function initCardNumbers() {
    const cards = document.querySelectorAll('.project-card');
    cards.forEach((card, i) => {
      if (card.querySelector('.ed-card-number')) return;

      const num = document.createElement('span');
      num.className = 'ed-card-number';
      num.setAttribute('aria-hidden', 'true');
      num.textContent = String(i + 1).padStart(2, '0');
      num.style.cssText = `
        position: absolute;
        top: 12px;
        right: 14px;
        font-family: 'DM Mono', monospace;
        font-size: 0.62rem;
        letter-spacing: 0.12em;
        color: rgba(13,12,10,0.2);
        z-index: 2;
        transition: color 0.35s ease;
        pointer-events: none;
      `;
      card.appendChild(num);

      // On hover — number inverts with the card
      card.addEventListener('mouseenter', () => {
        num.style.color = 'rgba(242,239,232,0.3)';
      });
      card.addEventListener('mouseleave', () => {
        num.style.color = 'rgba(13,12,10,0.2)';
      });
    });
  }

  /* ── 3. INK CURSOR ──────────────────────────────────────────
     Custom cursor: small filled circle, no lag.
     Desktop only — hidden on touch devices.
  ─────────────────────────────────────────────────────────── */
  function initInkCursor() {
    if (window.matchMedia('(pointer: coarse)').matches) return;

    const cursor = document.createElement('div');
    cursor.id = 'ed-ink-cursor';
    cursor.style.cssText = `
      position: fixed;
      width: 8px;
      height: 8px;
      background: #0D0C0A;
      border-radius: 50%;
      pointer-events: none;
      z-index: 99999;
      transform: translate(-50%, -50%);
      transition: width 0.2s, height 0.2s, opacity 0.2s;
      mix-blend-mode: multiply;
      opacity: 0;
    `;
    document.body.appendChild(cursor);

    const ring = document.createElement('div');
    ring.id = 'ed-ink-ring';
    ring.style.cssText = `
      position: fixed;
      width: 32px;
      height: 32px;
      border: 1px solid rgba(13,12,10,0.4);
      border-radius: 50%;
      pointer-events: none;
      z-index: 99998;
      transform: translate(-50%, -50%);
      transition: width 0.35s cubic-bezier(0.16,1,0.3,1),
                  height 0.35s cubic-bezier(0.16,1,0.3,1),
                  opacity 0.2s;
      opacity: 0;
    `;
    document.body.appendChild(ring);

    let mouseX = 0, mouseY = 0;
    let ringX = 0, ringY = 0;

    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      cursor.style.left = mouseX + 'px';
      cursor.style.top  = mouseY + 'px';
      cursor.style.opacity = '1';
      ring.style.opacity = '1';
    });

    document.addEventListener('mouseleave', () => {
      cursor.style.opacity = '0';
      ring.style.opacity = '0';
    });

    // Hover states — cursor grows on interactive elements
    document.addEventListener('mouseover', (e) => {
      const el = e.target;
      const isInteractive = el.matches('a, button, .project-card, .skill-tag, [contenteditable]');
      if (isInteractive) {
        cursor.style.width  = '14px';
        cursor.style.height = '14px';
        ring.style.width    = '48px';
        ring.style.height   = '48px';
      } else {
        cursor.style.width  = '8px';
        cursor.style.height = '8px';
        ring.style.width    = '32px';
        ring.style.height   = '32px';
      }
    });

    // Smooth ring follow
    function followRing() {
      if (!_active) return;
      ringX += (mouseX - ringX) * 0.12;
      ringY += (mouseY - ringY) * 0.12;
      ring.style.left = ringX + 'px';
      ring.style.top  = ringY + 'px';
      requestAnimationFrame(followRing);
    }
    followRing();
  }

  /* ── 4. CARD REVEAL — wipe from bottom ─────────────────────
     Uses IntersectionObserver. CSS class `.ed-revealed` triggers
     the animation defined inline.
  ─────────────────────────────────────────────────────────── */
  function initCardReveal() {
    const style = document.createElement('style');
    style.id = 'ed-reveal-style';
    style.textContent = `
      [data-theme="editorial"] .project-card,
      .theme-editorial .project-card {
        opacity: 0;
        transform: translateY(24px);
        transition: opacity 0.55s cubic-bezier(0.16,1,0.3,1),
                    transform 0.55s cubic-bezier(0.16,1,0.3,1);
      }
      [data-theme="editorial"] .project-card.ed-revealed,
      .theme-editorial .project-card.ed-revealed {
        opacity: 1;
        transform: translateY(0);
      }
    `;
    document.head.appendChild(style);

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          const card = entry.target;
          const delay = (Array.from(document.querySelectorAll('.project-card')).indexOf(card) % 3) * 80;
          setTimeout(() => card.classList.add('ed-revealed'), delay);
          observer.unobserve(card);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.project-card').forEach(card => observer.observe(card));
    _observers.push(observer);
  }

  /* ── 5. HERO NAME SCROLL EFFECT ────────────────────────────
     Slight letter-spacing compression on scroll — like text
     being pressed into the page.
  ─────────────────────────────────────────────────────────── */
  function initHeroScroll() {
    const nameEl = document.querySelector('.portfolio-hero__name');
    if (!nameEl) return;

    let ticking = false;

    function onScroll() {
      _scrollY = window.scrollY;
      if (!ticking) {
        requestAnimationFrame(() => {
          if (!_active || !_isActive()) return;
          const progress = Math.min(_scrollY / 300, 1);
          const spacing = -0.04 - (progress * 0.02);
          const scale = 1 - (progress * 0.04);
          nameEl.style.letterSpacing = `${spacing}em`;
          nameEl.style.transform = `scale(${scale})`;
          nameEl.style.transformOrigin = 'left top';
          ticking = false;
        });
        ticking = true;
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    _timeouts.push({ _isListener: true, fn: onScroll, type: 'scroll' });
  }

  /* ── 6. MUTATION OBSERVER — new cards ─────────────────────
  ─────────────────────────────────────────────────────────── */
  function initMutationObserver() {
    const grid = document.querySelector('.projects-grid, [data-projects-grid]');
    if (!grid) return;

    const observer = new MutationObserver(() => {
      _setTimeout(() => {
        initCardNumbers();
      }, 50);
    });
    observer.observe(grid, { childList: true });
    _observers.push(observer);
  }

  /* ── PUBLIC API ───────────────────────────────────────────── */
  function init() {
    if (_active) return;
    _active = true;

    requestAnimationFrame(() => {
      initTicker();
      initCardNumbers();
      initInkCursor();
      initCardReveal();
      initHeroScroll();
      initMutationObserver();
    });
  }

  function destroy() {
    if (!_active) return;
    _active = false;

    // Clear timeouts
    _timeouts.forEach(item => {
      if (item && item._isListener) {
        window.removeEventListener(item.type, item.fn);
      } else {
        clearTimeout(item);
      }
    });
    _timeouts = [];

    // Disconnect observers
    _observers.forEach(o => o.disconnect?.());
    _observers = [];

    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }

    // Remove injected elements
    document.querySelector('.ed-ticker')?.remove();
    document.getElementById('ed-ink-cursor')?.remove();
    document.getElementById('ed-ink-ring')?.remove();
    document.getElementById('ed-reveal-style')?.remove();
    document.querySelectorAll('.ed-card-number').forEach(el => el.remove());

    // Reset hero name
    const nameEl = document.querySelector('.portfolio-hero__name');
    if (nameEl) {
      nameEl.style.letterSpacing = '';
      nameEl.style.transform = '';
    }

    // Reset cards opacity
    document.querySelectorAll('.project-card').forEach(card => {
      card.classList.remove('ed-revealed');
      card.style.opacity = '';
      card.style.transform = '';
    });

    // Reset body cursor
    document.body.style.cursor = '';
  }

  window.EditorialFX = { init, destroy };
})();
