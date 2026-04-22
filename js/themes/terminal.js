/**
 * terminal.js — Terminal Theme Effects
 * Exposed as: window.TerminalFX
 *
 * Effects:
 *  1. Window chrome injection (macOS-style title bar + tab)
 *  2. Boot sequence — text scrolls before content reveals
 *  3. Typewriter on hero name (character by character)
 *  4. Block cursor that blinks after name finishes typing
 *  5. neofetch-style info block injection
 *  6. Command prompt injected before each section
 *  7. Card reveal — each card "prints" line by line
 *  8. Skills formatted as package list with versions
 *  9. Block cursor follows active editable element
 * 10. Idle matrix rain after 30s of no interaction
 * 11. MutationObserver for new cards
 */

(function () {
  'use strict';

  let _active    = false;
  let _timeouts  = [];
  let _intervals = [];
  let _listeners = [];
  let _observers = [];
  let _idleTimer = null;
  let _matrixRaf = null;
  let _matrixCanvas = null;

  const GREEN       = '#39ff14';
  const GREEN_BRIGHT= '#00ff88';
  const GREEN_DIM   = 'rgba(57,255,20,0.45)';
  const CYAN        = '#00d4ff';
  const AMBER       = '#ffb700';
  const DIM         = 'rgba(200,255,200,0.28)';
  const COMMENT     = '#555f55';
  const USER        = 'dev';
  const HOST        = 'portfolio';

  /* ── Helpers ── */
  function _t(fn, ms)   { const id = setTimeout(fn, ms); _timeouts.push(id); return id; }
  function _iv(fn, ms)  { const id = setInterval(fn, ms); _intervals.push(id); return id; }
  function _on(el, ev, fn, opts) {
    el.addEventListener(ev, fn, opts);
    _listeners.push({ el, ev, fn });
  }
  function _isActive() {
    return document.body.getAttribute('data-theme') === 'terminal'
        || document.documentElement.getAttribute('data-theme') === 'terminal';
  }
  function _esc(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ══════════════════════════════════════════════════════
     1. WINDOW CHROME
  ══════════════════════════════════════════════════════ */
  function initWindowChrome() {
    if (document.querySelector('.tm-window')) return;

    const nameEl = document.querySelector('.portfolio-hero__name');
    const name   = nameEl?.textContent?.trim() || 'developer';
    const tabLabel = `${USER}@${HOST}: ~/${name.toLowerCase().replace(/\s+/g,'-')}`;

    const win = document.createElement('div');
    win.className = 'tm-window';
    win.setAttribute('aria-hidden', 'true');
    win.innerHTML = `
      <div class="tm-dots">
        <div class="tm-dot tm-dot--close"></div>
        <div class="tm-dot tm-dot--min"></div>
        <div class="tm-dot tm-dot--max"></div>
      </div>
      <div class="tm-tab">
        <div class="tm-tab__dot"></div>
        <span>${_esc(tabLabel)}</span>
      </div>
      <div class="tm-title">bash — 80×24</div>
    `;

    const toolbar   = document.getElementById('edit-toolbar');
    const container = document.querySelector('.portfolio-container, .portfolio-wrapper');
    if (toolbar && toolbar.nextSibling) {
      toolbar.parentNode.insertBefore(win, toolbar.nextSibling);
    } else if (container) {
      container.parentNode.insertBefore(win, container);
    }
  }

  /* ══════════════════════════════════════════════════════
     2. BOOT SEQUENCE — fast-scrolling text then reveal
  ══════════════════════════════════════════════════════ */
  function initBootSequence(onComplete) {
    const container = document.querySelector('.portfolio-container, .portfolio-wrapper');
    if (!container) { onComplete?.(); return; }

    const lines = [
      { t: 'comment', v: '# Initializing portfolio session...' },
      { t: 'cmd',     v: `${USER}@${HOST}:~$ whoami` },
      { t: 'out',     v: 'developer · engineer · builder' },
      { t: 'cmd',     v: `${USER}@${HOST}:~$ uname -a` },
      { t: 'out',     v: 'Portfolio 2.0.0 #1 SMP x86_64 GNU/Linux' },
      { t: 'cmd',     v: `${USER}@${HOST}:~$ cat ~/.profile` },
      { t: 'out',     v: 'Loading environment variables...' },
      { t: 'out',     v: 'export NODE_ENV=production' },
      { t: 'out',     v: 'export AVAILABLE_FOR_HIRE=true' },
      { t: 'cmd',     v: `${USER}@${HOST}:~$ portfolio --start` },
    ];

    const overlay = document.createElement('div');
    overlay.id = 'tm-boot';
    overlay.style.cssText = `
      position: fixed; inset: 0;
      background: #0c0c0c;
      z-index: 9997;
      display: flex; flex-direction: column; justify-content: flex-end;
      padding: 28px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      line-height: 1.8;
      overflow: hidden;
    `;

    document.body.appendChild(overlay);
    container.style.opacity = '0';

    let i = 0;
    function printLine() {
      if (!_active) { overlay.remove(); container.style.opacity = '1'; return; }
      if (i >= lines.length) {
        _t(() => {
          overlay.style.transition = 'opacity 0.4s ease';
          overlay.style.opacity = '0';
          container.style.transition = 'opacity 0.4s ease';
          container.style.opacity = '1';
          _t(() => { overlay.remove(); onComplete?.(); }, 420);
        }, 200);
        return;
      }
      const line = lines[i++];
      const el = document.createElement('div');
      if (line.t === 'comment') {
        el.style.color = COMMENT; el.style.fontStyle = 'italic';
      } else if (line.t === 'cmd') {
        el.style.color = GREEN_DIM;
      } else {
        el.style.color = 'rgba(200,255,200,0.5)'; el.style.paddingLeft = '16px';
      }
      el.textContent = line.v;
      overlay.appendChild(el);
      /* Keep last N lines visible */
      if (overlay.children.length > 12) overlay.firstChild.remove();
      _t(printLine, 60 + Math.random() * 80);
    }
    printLine();
  }

  /* ══════════════════════════════════════════════════════
     3 + 4. TYPEWRITER + BLOCK CURSOR on hero name
  ══════════════════════════════════════════════════════ */
  function initTypewriter() {
    const nameEl = document.querySelector('.portfolio-hero__name');
    if (!nameEl || nameEl.dataset.tmTyped) return;
    nameEl.dataset.tmTyped = '1';

    const original = nameEl.textContent.trim();
    nameEl.textContent = '';

    /* Block cursor element */
    const cursor = document.createElement('span');
    cursor.id = 'tm-name-cursor';
    cursor.style.cssText = `
      display: inline-block;
      width: 0.6em; height: 0.85em;
      background: ${GREEN};
      box-shadow: 0 0 10px rgba(57,255,20,0.6);
      vertical-align: middle;
      margin-left: 2px;
      animation: tm-cursor-blink 1s step-end infinite;
    `;

    /* Add blink keyframe */
    if (!document.getElementById('tm-cursor-style')) {
      const s = document.createElement('style');
      s.id = 'tm-cursor-style';
      s.textContent = `
        @keyframes tm-cursor-blink {
          0%,100% { opacity:1; }
          50%      { opacity:0; }
        }
      `;
      document.head.appendChild(s);
    }

    nameEl.appendChild(cursor);

    let charIdx = 0;
    function typeChar() {
      if (!_active) { nameEl.textContent = original; return; }
      if (charIdx < original.length) {
        nameEl.insertBefore(document.createTextNode(original[charIdx]), cursor);
        charIdx++;
        _t(typeChar, 55 + Math.random() * 65);
      } else {
        /* Typing done — cursor stays blinking */
      }
    }
    _t(typeChar, 200);
  }

  /* ══════════════════════════════════════════════════════
     5. NEOFETCH INFO BLOCK
     Injected below hero links, above section divider
  ══════════════════════════════════════════════════════ */
  function initNeofetch() {
    if (document.querySelector('.tm-neofetch')) return;

    const projectCount = document.querySelectorAll('.project-card').length || 6;
    const skillCount   = document.querySelectorAll('.skill-tag:not(.skill-tag--add)').length || 12;
    const nameEl       = document.querySelector('.portfolio-hero__name');
    const name         = nameEl?.textContent?.trim() || 'Developer';
    const titleEl      = document.querySelector('.portfolio-hero__title');
    const title        = titleEl?.textContent?.replace('→','').trim() || 'Software Engineer';

    const block = document.createElement('div');
    block.className = 'tm-neofetch';
    block.setAttribute('aria-hidden', 'true');
    block.style.cssText = `
      font-family: 'JetBrains Mono', monospace;
      font-size: 11.5px;
      line-height: 1.9;
      padding: 20px 0 8px;
      border-top: 1px solid rgba(57,255,20,0.1);
      margin-top: 28px;
    `;

    const rows = [
      { k: `${USER}@${HOST}`,         v: null,  kc: GREEN_BRIGHT, vc: null },
      { k: '─'.repeat((`${USER}@${HOST}`).length), v: null, kc: GREEN_DIM, vc: null },
      { k: 'Name',      v: name,           kc: GREEN,       vc: 'rgba(200,255,200,0.7)' },
      { k: 'Role',      v: title,          kc: GREEN,       vc: 'rgba(200,255,200,0.7)' },
      { k: 'Projects',  v: `${projectCount} repositories`, kc: GREEN, vc: CYAN },
      { k: 'Skills',    v: `${skillCount} technologies`, kc: GREEN, vc: CYAN },
      { k: 'Status',    v: 'Available for hire', kc: GREEN, vc: AMBER },
      { k: 'Shell',     v: 'bash 5.2.0',   kc: GREEN,       vc: DIM },
      { k: 'Terminal',  v: 'GPORT v2.0',   kc: GREEN,       vc: DIM },
    ];

    block.innerHTML = rows.map(r => {
      if (!r.v) {
        return `<div style="color:${r.kc}">${r.k}</div>`;
      }
      return `<div>
        <span style="color:${r.kc};min-width:90px;display:inline-block">${r.k}</span>
        <span style="color:${DIM}">: </span>
        <span style="color:${r.vc}">${r.v}</span>
      </div>`;
    }).join('');

    /* Color swatches row */
    const swatches = ['#39ff14','#00ff88','#00d4ff','#ffb700','#ff4444','#aa44ff','#555f55','#c8ffc8'];
    const swatchRow = document.createElement('div');
    swatchRow.style.cssText = 'margin-top: 8px; display: flex; gap: 5px;';
    swatches.forEach(c => {
      const s = document.createElement('span');
      s.style.cssText = `
        display:inline-block; width:14px; height:14px;
        background:${c}; box-shadow:0 0 6px ${c}55;
      `;
      swatchRow.appendChild(s);
    });
    block.appendChild(swatchRow);

    const heroLinks = document.querySelector('.hero-links, #hero-links');
    if (heroLinks) heroLinks.parentNode.insertBefore(block, heroLinks.nextSibling);
  }

  /* ══════════════════════════════════════════════════════
     6. COMMAND PROMPTS before sections
  ══════════════════════════════════════════════════════ */
  function initSectionPrompts() {
    /* Map section label text → git/ls command */
    const cmdMap = {
      'skills':   'ls -la ~/.skills/',
      'projects': 'git log --oneline --graph --all',
    };

    document.querySelectorAll('.section-label').forEach(label => {
      if (label.dataset.tmPrompt) return;
      label.dataset.tmPrompt = '1';

      const key = label.textContent.trim().toLowerCase();
      const cmd = cmdMap[key] || `cat ~/.${key}`;
      const span = label.querySelector('span');
      if (span) span.textContent = cmd;
    });
  }

  /* ══════════════════════════════════════════════════════
     7. CARD PRINT REVEAL — cards appear as output lines
  ══════════════════════════════════════════════════════ */
  function initCardReveal() {
    const style = document.createElement('style');
    style.id = 'tm-reveal-style';
    style.textContent = `
      [data-theme="terminal"] .project-card,
      .theme-terminal .project-card {
        opacity: 0;
        transform: translateY(6px);
        transition: opacity 0.4s ease, transform 0.4s cubic-bezier(0.16,1,0.3,1);
      }
      [data-theme="terminal"] .project-card.tm-revealed,
      .theme-terminal .project-card.tm-revealed {
        opacity: 1;
        transform: translateY(0);
      }
    `;
    document.head.appendChild(style);

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const card = entry.target;
        const all  = [...document.querySelectorAll('.project-card')];
        const i    = all.indexOf(card);
        _t(() => card.classList.add('tm-revealed'), (i % 3) * 80);
        obs.unobserve(card);
      });
    }, { threshold: 0.05, rootMargin: '0px 0px -20px 0px' });

    document.querySelectorAll('.project-card').forEach(c => obs.observe(c));
    _observers.push(obs);
  }

  /* ══════════════════════════════════════════════════════
     8. SKILLS — package list format
  ══════════════════════════════════════════════════════ */
  function initSkillVersions() {
    const style = document.getElementById('tm-skill-style') || document.createElement('style');
    style.id = 'tm-skill-style';
    style.textContent = `
      [data-theme="terminal"] .skill-tag:not(.skill-tag--add),
      .theme-terminal .skill-tag:not(.skill-tag--add) {
        opacity: 0;
        transition: opacity 0.3s ease;
      }
      [data-theme="terminal"] .skill-tag.tm-revealed,
      .theme-terminal .skill-tag.tm-revealed { opacity: 1; }
    `;
    document.head.appendChild(style);

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const tags = [...document.querySelectorAll('.skill-tag:not(.skill-tag--add)')];
        tags.forEach((tag, i) => {
          _t(() => tag.classList.add('tm-revealed'), i * 35);
        });
        obs.disconnect();
      });
    }, { threshold: 0.1 });

    const container = document.querySelector('.skills-container');
    if (container) obs.observe(container);
    _observers.push(obs);
  }

  /* ══════════════════════════════════════════════════════
     9. BLOCK CURSOR on active editable
  ══════════════════════════════════════════════════════ */
  function initEditCursor() {
    const cursor = document.createElement('div');
    cursor.id = 'tm-edit-cursor';
    cursor.style.cssText = `
      position: fixed;
      width: 2px;
      height: 1.2em;
      background: ${GREEN};
      box-shadow: 0 0 8px rgba(57,255,20,0.5);
      pointer-events: none;
      z-index: 9999;
      opacity: 0;
      transition: opacity 0.15s;
      animation: tm-cursor-blink 1s step-end infinite;
    `;
    document.body.appendChild(cursor);

    _on(document, 'selectionchange', () => {
      const sel = window.getSelection();
      if (!sel?.rangeCount) { cursor.style.opacity = '0'; return; }
      const range = sel.getRangeAt(0);
      const rects = range.getClientRects();
      if (!rects.length) { cursor.style.opacity = '0'; return; }
      const r = rects[rects.length - 1];
      cursor.style.left   = r.right + 'px';
      cursor.style.top    = r.top   + 'px';
      cursor.style.height = r.height + 'px';
      cursor.style.opacity = '1';
    });

    _on(document, 'click', (e) => {
      if (!e.target.closest('[contenteditable]')) cursor.style.opacity = '0';
    });
  }

  /* ══════════════════════════════════════════════════════
     10. MATRIX RAIN — idle for 30s
  ══════════════════════════════════════════════════════ */
  const MATRIX_CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF><+-=/*$#@!~';

  function startMatrixRain() {
    if (_matrixCanvas) return;

    _matrixCanvas = document.createElement('canvas');
    _matrixCanvas.id = 'tm-matrix';
    _matrixCanvas.style.cssText = `
      position: fixed; inset: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: 9996;
      opacity: 0;
      transition: opacity 1s ease;
    `;
    document.body.appendChild(_matrixCanvas);

    const ctx  = _matrixCanvas.getContext('2d');
    const W    = _matrixCanvas.width  = window.innerWidth;
    const H    = _matrixCanvas.height = window.innerHeight;
    const COLS = Math.floor(W / 16);
    const drops = Array(COLS).fill(1);

    requestAnimationFrame(() => { _matrixCanvas.style.opacity = '0.18'; });

    _matrixRaf = setInterval(() => {
      if (!_active) { stopMatrixRain(); return; }
      ctx.fillStyle = 'rgba(12,12,12,0.06)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#39ff14';
      ctx.font = '14px "JetBrains Mono", monospace';

      drops.forEach((y, i) => {
        const char = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
        ctx.fillText(char, i * 16, y * 16);
        if (y * 16 > H && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      });
    }, 55);
  }

  function stopMatrixRain() {
    if (!_matrixCanvas) return;
    clearInterval(_matrixRaf); _matrixRaf = null;
    _matrixCanvas.style.opacity = '0';
    setTimeout(() => { _matrixCanvas?.remove(); _matrixCanvas = null; }, 1000);
  }

  function initIdleMatrix() {
    let lastActivity = Date.now();

    function resetIdle() {
      lastActivity = Date.now();
      if (_matrixCanvas) stopMatrixRain();
      clearTimeout(_idleTimer);
      _idleTimer = setTimeout(() => {
        if (_active && _isActive()) startMatrixRain();
      }, 30000);
    }

    ['mousemove','keydown','click','scroll'].forEach(ev => {
      _on(document, ev, resetIdle, { passive: true });
    });

    _idleTimer = setTimeout(() => {
      if (_active && _isActive()) startMatrixRain();
    }, 30000);
  }

  /* ══════════════════════════════════════════════════════
     11. MUTATION OBSERVER
  ══════════════════════════════════════════════════════ */
  function initMutationObserver() {
    const grid = document.querySelector('.projects-grid, [data-projects-grid]');
    if (!grid) return;
    const obs = new MutationObserver(() => { _t(initSectionPrompts, 60); });
    obs.observe(grid, { childList: true });
    _observers.push(obs);
  }

  /* ══════════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════════ */
  function init() {
    if (_active) return;
    _active = true;

    /* Boot sequence → then everything else */
    initBootSequence(() => {
      if (!_active) return;
      requestAnimationFrame(() => {
        initWindowChrome();
        initTypewriter();
        initNeofetch();
        initSectionPrompts();
        initCardReveal();
        initSkillVersions();
        initEditCursor();
        initIdleMatrix();
        initMutationObserver();
      });
    });
  }

  function destroy() {
    if (!_active) return;
    _active = false;

    _timeouts.forEach(clearTimeout);   _timeouts = [];
    _intervals.forEach(clearInterval); _intervals = [];
    _listeners.forEach(({ el, ev, fn }) => el.removeEventListener(ev, fn));
    _listeners = [];
    _observers.forEach(o => o.disconnect?.()); _observers = [];
    clearTimeout(_idleTimer); _idleTimer = null;
    if (_matrixRaf) { clearInterval(_matrixRaf); _matrixRaf = null; }

    /* DOM cleanup */
    ['#tm-boot','#tm-matrix','.tm-window','.tm-neofetch',
     '#tm-name-cursor','#tm-edit-cursor','#tm-cursor-style',
     '#tm-reveal-style','#tm-skill-style']
      .forEach(sel => document.querySelectorAll(sel).forEach(el => el.remove()));

    document.body.classList.remove('tm-cursor-active');

    /* Reset hero name */
    const nameEl = document.querySelector('.portfolio-hero__name');
    if (nameEl?.dataset?.tmTyped) {
      nameEl.textContent = nameEl.textContent.replace(/\u00a0/g,'').trim();
      delete nameEl.dataset.tmTyped;
    }

    /* Reset cards */
    document.querySelectorAll('.project-card').forEach(c => {
      c.classList.remove('tm-revealed');
      c.style.opacity = '';
      c.style.transform = '';
    });

    document.querySelectorAll('.skill-tag').forEach(t => {
      t.classList.remove('tm-revealed');
      t.style.opacity = '';
    });

    document.querySelectorAll('.section-label[data-tm-prompt]').forEach(el => {
      delete el.dataset.tmPrompt;
    });

    /* Restore container visibility */
    const container = document.querySelector('.portfolio-container, .portfolio-wrapper');
    if (container) { container.style.opacity = '1'; container.style.transition = ''; }
  }

  window.TerminalFX = { init, destroy };

})();
