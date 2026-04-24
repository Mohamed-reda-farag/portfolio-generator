/**
 * blueprint.js — Blueprint Theme Effects
 * Exposed as: window.BlueprintFX
 *
 * Effects:
 *  1. Title block injection (engineering drawing header)
 *  2. SVG corner brackets on every project card
 *  3. Dimension annotations (width × height labels)
 *  4. Technical crosshair cursor with coordinates
 *  5. Card reveal — scan-line wipe from top
 *  6. Skills stagger reveal with coordinate flash
 *  7. Hero name coordinate annotation
 *  8. MutationObserver for new cards
 */

(function () {
  'use strict';

  let _active    = false;
  let _timeouts  = [];
  let _listeners = [];
  let _observers = [];
  let _raf       = null;

  const BLUE   = '#4a9eff';
  const YELLOW = '#ffd600';
  const WHITE  = 'rgba(232,244,255,0.6)';
  const DIM    = 'rgba(232,244,255,0.2)';

  /* ── Helpers ── */
  function _t(fn, ms)  { const id = setTimeout(fn, ms); _timeouts.push(id); }
  function _on(el, ev, fn, opts) {
    el.addEventListener(ev, fn, opts);
    _listeners.push({ el, ev, fn });
  }
  function _isActive() {
    return document.body.getAttribute('data-theme') === 'blueprint'
        || document.documentElement.getAttribute('data-theme') === 'blueprint';
  }

  /* ══════════════════════════════════════════════════
     1. TITLE BLOCK — engineering drawing header
  ══════════════════════════════════════════════════ */
  function initTitleBlock() {
    if (document.querySelector('.bp-titleblock')) return;

    const projectCount = document.querySelectorAll('.project-card').length || 6;
    const skillCount   = document.querySelectorAll('.skill-tag:not(.skill-tag--add)').length || 12;
    const nameEl       = document.querySelector('.portfolio-hero__name');
    const name         = nameEl?.textContent?.trim().toUpperCase() || 'DEVELOPER';
    const rev          = `REV ${String(Math.floor(Math.random() * 8) + 1).padStart(2,'0')}`;
    const date         = new Date();
    const dateStr      = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;

    const block = document.createElement('div');
    block.className = 'bp-titleblock';
    block.setAttribute('aria-hidden', 'true');
    block.innerHTML = `
      <div class="bp-titleblock__cell">
        <span class="bp-titleblock__label">Project</span>
        <span class="bp-titleblock__value">${name}</span>
      </div>
      <div class="bp-titleblock__cell">
        <span class="bp-titleblock__label">Components</span>
        <span class="bp-titleblock__value">${projectCount} modules · ${skillCount} specs</span>
      </div>
      <div class="bp-titleblock__cell">
        <span class="bp-titleblock__label">Status</span>
        <span class="bp-titleblock__value--yellow">◈ AVAILABLE</span>
      </div>
      <div class="bp-titleblock__cell">
        <span class="bp-titleblock__label">Date</span>
        <span class="bp-titleblock__value">${dateStr}</span>
      </div>
      <div class="bp-titleblock__cell">
        <span class="bp-titleblock__label">Revision</span>
        <span class="bp-titleblock__value bp-titleblock__value--yellow">${rev}</span>
      </div>
    `;

    const toolbar   = document.getElementById('edit-toolbar');
    const container = document.querySelector('.portfolio-container, .portfolio-wrapper');
    if (toolbar && toolbar.nextSibling) {
      toolbar.parentNode.insertBefore(block, toolbar.nextSibling);
    } else if (container) {
      container.parentNode.insertBefore(block, container);
    }
  }

  /* ══════════════════════════════════════════════════
     2 + 3. SVG CORNER BRACKETS + DIMENSION LINES
  ══════════════════════════════════════════════════ */
  const BRACKET = 14; /* px — bracket arm length */

  function makeBracketSVG(w, h, color) {
    const b = BRACKET;
    const pad = 6;  /* how far outside the card edge */
    const svgW = w + pad * 2;
    const svgH = h + pad * 2;

    return `
<svg
  class="bp-brackets"
  xmlns="http://www.w3.org/2000/svg"
  width="${svgW}" height="${svgH}"
  viewBox="0 0 ${svgW} ${svgH}"
  aria-hidden="true"
  style="
    position:absolute;
    top:${-pad}px; left:${-pad}px;
    pointer-events:none;
    z-index:4;
    overflow:visible;
  "
>
  <!-- top-left -->
  <path d="M${pad+b},${pad} L${pad},${pad} L${pad},${pad+b}"
    fill="none" stroke="${color}" stroke-width="1.5"/>
  <!-- top-right -->
  <path d="M${svgW-pad-b},${pad} L${svgW-pad},${pad} L${svgW-pad},${pad+b}"
    fill="none" stroke="${color}" stroke-width="1.5"/>
  <!-- bottom-left -->
  <path d="M${pad+b},${svgH-pad} L${pad},${svgH-pad} L${pad},${svgH-pad-b}"
    fill="none" stroke="${color}" stroke-width="1.5"/>
  <!-- bottom-right -->
  <path d="M${svgW-pad-b},${svgH-pad} L${svgW-pad},${svgH-pad} L${svgW-pad},${svgH-pad-b}"
    fill="none" stroke="${color}" stroke-width="1.5"/>
</svg>`;
  }

  function makeDimensionSVG(w, h) {
    const pad = 6;
    const svgW = w + pad * 2;
    const svgH = h + pad * 2;
    const tickH = 4;
    const labelY = svgH + 14;

    return `
<svg
  class="bp-dimensions"
  xmlns="http://www.w3.org/2000/svg"
  width="${svgW}" height="${labelY + 8}"
  viewBox="0 0 ${svgW} ${labelY + 8}"
  aria-hidden="true"
  style="
    position:absolute;
    top:${-pad}px; left:${-pad}px;
    pointer-events:none;
    z-index:3;
    overflow:visible;
    opacity:0;
    transition: opacity 0.3s ease;
  "
>
  <!-- Width dimension line -->
  <line x1="${pad}" y1="${svgH+6}" x2="${svgW-pad}" y2="${svgH+6}"
    stroke="${DIM}" stroke-width="0.75"/>
  <!-- Left tick -->
  <line x1="${pad}" y1="${svgH+6-tickH}" x2="${pad}" y2="${svgH+6+tickH}"
    stroke="${DIM}" stroke-width="0.75"/>
  <!-- Right tick -->
  <line x1="${svgW-pad}" y1="${svgH+6-tickH}" x2="${svgW-pad}" y2="${svgH+6+tickH}"
    stroke="${DIM}" stroke-width="0.75"/>
  <!-- Width label -->
  <text x="${svgW/2}" y="${labelY}"
    text-anchor="middle"
    font-family="'Share Tech Mono', monospace"
    font-size="9"
    fill="${YELLOW}"
    opacity="0.7"
    letter-spacing="0.1"
  >${w}px</text>
</svg>`;
  }

  function applyBrackets(card) {
    if (card.dataset.bpBracket) return;
    card.dataset.bpBracket = '1';
    card.style.position = 'relative';

    /* Use rAF to get correct rect after layout */
    requestAnimationFrame(() => {
      const rect = card.getBoundingClientRect();
      const w    = Math.round(rect.width);
      const h    = Math.round(rect.height);

      /* Determine bracket color */
      const isFeatured = card.classList.contains('project-card--featured');
      const color = isFeatured ? YELLOW : BLUE;

      /* Inject brackets */
      const bracketWrap = document.createElement('div');
      bracketWrap.innerHTML = makeBracketSVG(w, h, color);
      const bracketSvg = bracketWrap.firstElementChild;
      card.appendChild(bracketSvg);

      /* Inject dimensions (shown on hover) */
      const dimWrap = document.createElement('div');
      dimWrap.innerHTML = makeDimensionSVG(w, h);
      const dimSvg = dimWrap.firstElementChild;
      card.appendChild(dimSvg);

      /* Show/hide dim on hover */
      card.addEventListener('mouseenter', () => { dimSvg.style.opacity = '1'; });
      card.addEventListener('mouseleave', () => { dimSvg.style.opacity = '0'; });
    });
  }

  function initCardBrackets() {
    document.querySelectorAll('.project-card').forEach(applyBrackets);
  }

  /* ══════════════════════════════════════════════════
     4. CROSSHAIR CURSOR with live coordinates
  ══════════════════════════════════════════════════ */
  function initCursor() {
    if (window.matchMedia('(pointer: coarse)').matches) return;

    /* Crosshair lines */
    const hLine = document.createElement('div');
    hLine.id = 'bp-h-line';
    hLine.style.cssText = `
      position: fixed; pointer-events: none; z-index: 99998;
      left: 0; right: 0; height: 1px;
      background: rgba(74,158,255,0.25);
      transform: translateY(-50%);
      opacity: 0; transition: opacity 0.15s;
    `;

    const vLine = document.createElement('div');
    vLine.id = 'bp-v-line';
    vLine.style.cssText = `
      position: fixed; pointer-events: none; z-index: 99998;
      top: 0; bottom: 0; width: 1px;
      background: rgba(74,158,255,0.25);
      transform: translateX(-50%);
      opacity: 0; transition: opacity 0.15s;
    `;

    /* Center dot */
    const dot = document.createElement('div');
    dot.id = 'bp-cursor-dot';
    dot.style.cssText = `
      position: fixed; pointer-events: none; z-index: 99999;
      width: 8px; height: 8px;
      transform: translate(-50%, -50%);
      opacity: 0; transition: opacity 0.15s, width 0.2s, height 0.2s;
    `;
    dot.innerHTML = `
      <svg width="8" height="8" viewBox="0 0 8 8" xmlns="http://www.w3.org/2000/svg">
        <circle cx="4" cy="4" r="1.5" fill="${BLUE}"/>
        <line x1="4" y1="0" x2="4" y2="3" stroke="${BLUE}" stroke-width="0.75"/>
        <line x1="4" y1="5" x2="4" y2="8" stroke="${BLUE}" stroke-width="0.75"/>
        <line x1="0" y1="4" x2="3" y2="4" stroke="${BLUE}" stroke-width="0.75"/>
        <line x1="5" y1="4" x2="8" y2="4" stroke="${BLUE}" stroke-width="0.75"/>
      </svg>
    `;

    /* Coordinate label */
    const coords = document.createElement('div');
    coords.id = 'bp-coords';
    coords.style.cssText = `
      position: fixed; pointer-events: none; z-index: 99999;
      font-family: 'Share Tech Mono', monospace;
      font-size: 9px; letter-spacing: 0.12em;
      color: ${YELLOW}; opacity: 0;
      transition: opacity 0.15s;
      white-space: nowrap;
      text-shadow: 0 0 8px rgba(255,214,0,0.4);
      background: rgba(10,22,40,0.7);
      padding: 2px 6px;
    `;

    document.body.appendChild(hLine);
    document.body.appendChild(vLine);
    document.body.appendChild(dot);
    document.body.appendChild(coords);
    document.body.classList.add('bp-cursor-active');

    _on(document, 'mousemove', (e) => {
      const x = e.clientX, y = e.clientY;

      hLine.style.top  = y + 'px';
      hLine.style.opacity = '1';

      vLine.style.left = x + 'px';
      vLine.style.opacity = '1';

      dot.style.left = x + 'px';
      dot.style.top  = y + 'px';
      dot.style.opacity = '1';

      /* Coordinate label — offset so it doesn't overlap cursor */
      coords.style.left   = (x + 14) + 'px';
      coords.style.top    = (y - 22) + 'px';
      coords.style.opacity = '1';
      coords.textContent  = `X:${x} Y:${y}`;
    }, { passive: true });

    _on(document, 'mouseleave', () => {
      [hLine, vLine, dot, coords].forEach(el => el.style.opacity = '0');
    });

    /* Expand crosshair on hover of interactive */
    _on(document, 'mouseover', (e) => {
      const isI = e.target.matches('button,a,.project-card,.skill-tag,[contenteditable]');
      if (isI) {
        dot.style.width = dot.style.height = '14px';
        hLine.style.background = `rgba(74,158,255,0.45)`;
        vLine.style.background = `rgba(74,158,255,0.45)`;
      } else {
        dot.style.width = dot.style.height = '8px';
        hLine.style.background = `rgba(74,158,255,0.25)`;
        vLine.style.background = `rgba(74,158,255,0.25)`;
      }
    });
  }

  /* ══════════════════════════════════════════════════
     5. CARD REVEAL — scan-line wipe
  ══════════════════════════════════════════════════ */
  function initReveal() {
    const style = document.createElement('style');
    style.id = 'bp-reveal-style';
    style.textContent = `
      [data-theme="blueprint"] .project-card,
      .theme-blueprint .project-card {
        opacity: 0;
        clip-path: inset(0 100% 0 0);
        transition:
          opacity 0.5s ease,
          clip-path 0.6s cubic-bezier(0.16, 1, 0.3, 1);
      }
      [data-theme="blueprint"] .project-card.bp-revealed,
      .theme-blueprint .project-card.bp-revealed {
        opacity: 1;
        clip-path: inset(0 0% 0 0);
      }
      [data-theme="blueprint"] .section-label,
      .theme-blueprint .section-label {
        opacity: 0;
        transform: translateX(-20px);
        transition: opacity 0.45s ease, transform 0.45s cubic-bezier(0.16,1,0.3,1);
      }
      [data-theme="blueprint"] .section-label.bp-revealed,
      .theme-blueprint .section-label.bp-revealed {
        opacity: 1;
        transform: translateX(0);
      }
    `;
    document.head.appendChild(style);

    function observeElements(elements) {
      const obs = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const el  = entry.target;
          const all = [...document.querySelectorAll('.project-card')];
          const i   = all.indexOf(el);
          const delay = el.classList.contains('project-card') ? (i % 3) * 100 : 0;
          setTimeout(() => el.classList.add('bp-revealed'), delay);
          obs.unobserve(el);
        });
      }, { threshold: 0.06, rootMargin: '0px 0px -30px 0px' });

      elements.forEach(el => obs.observe(el));
      _observers.push(obs);
    }

    // Observe elements already in DOM
    const existing = [...document.querySelectorAll('.project-card, .section-label')];
    if (existing.length) observeElements(existing);

    // Also watch for cards added later (async render after data fetch)
    const grid = document.querySelector('.projects-grid, [data-projects-grid]');
    if (grid) {
      const gridObs = new MutationObserver((mutations) => {
        const newCards = [];
        mutations.forEach(m => m.addedNodes.forEach(node => {
          if (node.nodeType === 1 && node.classList.contains('project-card')) newCards.push(node);
        }));
        if (newCards.length) observeElements(newCards);
      });
      gridObs.observe(grid, { childList: true });
      _observers.push(gridObs);
    }
  }

  /* ══════════════════════════════════════════════════
     6. SKILLS — stagger with coordinate flash
  ══════════════════════════════════════════════════ */
  function initSkillReveal() {
    const style = document.getElementById('bp-skill-style') || document.createElement('style');
    style.id = 'bp-skill-style';
    style.textContent = `
      [data-theme="blueprint"] .skill-tag:not(.skill-tag--add),
      .theme-blueprint .skill-tag:not(.skill-tag--add) {
        opacity: 0; transform: scale(0.9);
        transition: opacity 0.35s ease, transform 0.35s cubic-bezier(0.16,1,0.3,1);
      }
      [data-theme="blueprint"] .skill-tag.bp-revealed,
      .theme-blueprint .skill-tag.bp-revealed {
        opacity: 1; transform: scale(1);
      }
    `;
    document.head.appendChild(style);

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const tags = [...document.querySelectorAll('.skill-tag:not(.skill-tag--add)')];
        tags.forEach((tag, i) => setTimeout(() => tag.classList.add('bp-revealed'), i * 45));
        obs.disconnect();
      });
    }, { threshold: 0.15 });

    const container = document.querySelector('.skills-container');
    if (container) obs.observe(container);
    _observers.push(obs);
  }

  /* ══════════════════════════════════════════════════
     7. HERO COORDINATE ANNOTATION
     Adds small X/Y coordinate labels around the name
  ══════════════════════════════════════════════════ */
  function initHeroAnnotation() {
    const nameEl = document.querySelector('.portfolio-hero__name');
    if (!nameEl || nameEl.dataset.bpAnnotated) return;
    nameEl.dataset.bpAnnotated = '1';

    /* Origin mark top-left of hero */
    const origin = document.createElement('div');
    origin.id = 'bp-origin';
    origin.setAttribute('aria-hidden', 'true');
    origin.style.cssText = `
      position: absolute;
      top: 0; left: 0;
      width: 20px; height: 20px;
      pointer-events: none;
      z-index: 2;
    `;
    origin.innerHTML = `
      <svg width="20" height="20" xmlns="http://www.w3.org/2000/svg">
        <line x1="0" y1="0" x2="12" y2="0" stroke="${YELLOW}" stroke-width="1" opacity="0.6"/>
        <line x1="0" y1="0" x2="0" y2="12" stroke="${YELLOW}" stroke-width="1" opacity="0.6"/>
        <circle cx="0" cy="0" r="2" fill="${YELLOW}" opacity="0.7"/>
        <text x="4" y="18"
          font-family="'Share Tech Mono',monospace"
          font-size="7" fill="${YELLOW}" opacity="0.5"
          letter-spacing="0.1">0,0</text>
      </svg>
    `;

    const hero = document.querySelector('.portfolio-hero');
    if (hero) {
      hero.style.position = 'relative';
      hero.appendChild(origin);
    }
  }

  /* ══════════════════════════════════════════════════
     8. MUTATION OBSERVER
  ══════════════════════════════════════════════════ */
  function initMutationObserver() {
    const grid = document.querySelector('.projects-grid, [data-projects-grid]');
    if (!grid) return;

    const obs = new MutationObserver((mutations) => {
      const addedCards = [];
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1 && node.classList.contains('project-card')) {
            addedCards.push(node);
          }
        });
      });

      if (addedCards.length) {
        // Apply brackets to new cards
        _t(() => addedCards.forEach(applyBrackets), 80);

        // Re-run reveal observer on new cards so they animate in instead of staying hidden
        // (initReveal ran before these cards existed in the DOM)
        const revealObs = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const el  = entry.target;
            const all = [...document.querySelectorAll('.project-card')];
            const i   = all.indexOf(el);
            const delay = (i % 3) * 100;
            setTimeout(() => el.classList.add('bp-revealed'), delay);
            revealObs.unobserve(el);
          });
        }, { threshold: 0.06, rootMargin: '0px 0px -30px 0px' });

        addedCards.forEach(card => revealObs.observe(card));
        _observers.push(revealObs);
      }
    });

    obs.observe(grid, { childList: true });
    _observers.push(obs);
  }

  /* ══════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════ */
  function init() {
    if (_active) return;
    _active = true;

    requestAnimationFrame(() => {
      initTitleBlock();
      initCardBrackets();
      initCursor();
      initReveal();
      initSkillReveal();
      initHeroAnnotation();
      initMutationObserver();
    });
  }

  function destroy() {
    if (!_active) return;
    _active = false;

    _timeouts.forEach(clearTimeout); _timeouts = [];
    _listeners.forEach(({ el, ev, fn }) => el.removeEventListener(ev, fn));
    _listeners = [];
    _observers.forEach(o => o.disconnect?.()); _observers = [];
    if (_raf) { cancelAnimationFrame(_raf); _raf = null; }

    /* DOM */
    document.querySelector('.bp-titleblock')?.remove();
    document.getElementById('bp-h-line')?.remove();
    document.getElementById('bp-v-line')?.remove();
    document.getElementById('bp-cursor-dot')?.remove();
    document.getElementById('bp-coords')?.remove();
    document.getElementById('bp-reveal-style')?.remove();
    document.getElementById('bp-skill-style')?.remove();
    document.getElementById('bp-origin')?.remove();
    document.body.classList.remove('bp-cursor-active');

    document.querySelectorAll('.bp-brackets, .bp-dimensions').forEach(el => el.remove());
    document.querySelectorAll('[data-bp-bracket]').forEach(el => delete el.dataset.bpBracket);
    document.querySelectorAll('[data-bp-annotated]').forEach(el => delete el.dataset.bpAnnotated);

    /* Reset cards */
    document.querySelectorAll('.project-card').forEach(card => {
      card.classList.remove('bp-revealed');
      card.style.opacity = '';
      card.style.clipPath = '';
      card.style.transition = '';
    });

    /* Reset labels & skills */
    document.querySelectorAll('.section-label, .skill-tag').forEach(el => {
      el.classList.remove('bp-revealed');
      el.style.opacity = '';
      el.style.transform = '';
    });
  }

  window.BlueprintFX = { init, destroy };

})();