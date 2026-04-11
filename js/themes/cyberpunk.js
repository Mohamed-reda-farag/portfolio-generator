/**
 * cyberpunk.js — Glitch & Neon Effects for Cyberpunk Theme
 *
 * Activated by Portfolio.loadThemeScript('cyberpunk') in portfolio.js
 * Exposed as: window.CyberpunkFX
 *
 * Effects:
 *  1. Glitch animation on hero name at load + random intervals
 *  2. Corner bracket decorators added to project cards
 *  3. "SYSTEM ONLINE" typing sequence in stats bar
 *  4. Subtle random scanline flicker
 */

(function () {
  'use strict';

  let _active = false;
  let _intervals = [];
  let _timeouts = [];

  /* ── Utility ──────────────────────────────────────────── */
  function _setInterval(fn, delay) {
    const id = setInterval(fn, delay);
    _intervals.push(id);
    return id;
  }

  function _setTimeout(fn, delay) {
    const id = setTimeout(fn, delay);
    _timeouts.push(id);
    return id;
  }

  /* ── 1. Glitch on hero name ────────────────────────────── */
  function initGlitch() {
    const nameEl = document.querySelector('.hero-name');
    if (!nameEl) return;

    // Store original text for glitch scramble
    const originalText = nameEl.textContent;
    const glitchChars = '!<>-_\\/[]{}—=+*^?#@$%&~'.split('');

    function scrambleText(el, original, duration) {
      let frame = 0;
      const totalFrames = Math.round(duration / 50);

      const raf = setInterval(() => {
        const progress = frame / totalFrames;
        let output = '';

        for (let i = 0; i < original.length; i++) {
          if (original[i] === ' ') {
            output += ' ';
            continue;
          }
          if (progress > i / original.length) {
            output += original[i];
          } else {
            output += glitchChars[Math.floor(Math.random() * glitchChars.length)];
          }
        }

        el.textContent = output;
        frame++;

        if (frame > totalFrames) {
          clearInterval(raf);
          el.textContent = original;
        }
      }, 50);
    }

    function triggerGlitch() {
      if (!document.body.dataset.theme === 'cyberpunk') return;
      nameEl.classList.add('glitch-active');
      scrambleText(nameEl, originalText, 400);

      _setTimeout(() => {
        nameEl.classList.remove('glitch-active');
      }, 500);
    }

    // Initial glitch on load
    _setTimeout(triggerGlitch, 600);

    // Random glitch every 8–20 seconds
    function scheduleGlitch() {
      const delay = 8000 + Math.random() * 12000;
      _setTimeout(() => {
        triggerGlitch();
        scheduleGlitch(); // reschedule
      }, delay);
    }
    scheduleGlitch();
  }

  /* ── 2. Corner decorators on project cards ─────────────── */
  function initCornerDecorators() {
    const cards = document.querySelectorAll('.project-card');
    cards.forEach((card) => {
      // Add the neon top bar element
      if (!card.querySelector('.neon-top-bar')) {
        const bar = document.createElement('div');
        bar.className = 'neon-top-bar';
        card.insertBefore(bar, card.firstChild);
      }
    });
  }

  /* ── 3. Typing sequence in stats ───────────────────────── */
  function initStatsTyping() {
    const statsBar = document.querySelector('.stats-bar');
    if (!statsBar) return;

    // Add a typing cursor label before stats load in
    const statusEl = document.createElement('div');
    statusEl.className = 'stats-system-status';
    statusEl.style.cssText = `
      position: absolute;
      top: 6px;
      right: 16px;
      font-size: 0.6rem;
      letter-spacing: 0.2em;
      color: var(--text-muted);
      font-family: inherit;
    `;

    const messages = ['INITIALIZING...', 'FETCHING STATS...', 'SYSTEM ONLINE ✓'];
    let msgIdx = 0;

    statusEl.textContent = messages[0];
    statsBar.style.position = 'relative';
    statsBar.appendChild(statusEl);

    function cycleMessage() {
      if (msgIdx < messages.length - 1) {
        msgIdx++;
        statusEl.textContent = messages[msgIdx];
        if (msgIdx < messages.length - 1) {
          _setTimeout(cycleMessage, 800);
        } else {
          // Final state — add glow
          statusEl.style.color = 'var(--accent)';
          statusEl.style.textShadow = '0 0 8px var(--accent-glow)';
        }
      }
    }

    _setTimeout(cycleMessage, 400);
  }

  /* ── 4. Scanline flicker ───────────────────────────────── */
  function initScanlineFlicker() {
    const overlay = document.createElement('div');
    overlay.id = 'cyberpunk-scanline-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 9999;
      background: transparent;
      transition: opacity 0.05s;
    `;
    document.body.appendChild(overlay);

    function flicker() {
      overlay.style.background = `rgba(0, 255, 170, 0.015)`;
      _setTimeout(() => {
        overlay.style.background = 'transparent';
      }, 60);
    }

    // Random flicker every 5–15s
    function scheduleFlicker() {
      const delay = 5000 + Math.random() * 10000;
      _setTimeout(() => {
        flicker();
        _setTimeout(flicker, 120);
        scheduleFlicker();
      }, delay);
    }

    scheduleFlicker();
  }

  /* ── 5. Neon hover ripple on skill tags ─────────────────── */
  function initSkillHoverRipple() {
    document.querySelectorAll('.skill-tag').forEach((tag) => {
      tag.addEventListener('mouseenter', function () {
        this.style.boxShadow = '0 0 16px rgba(0, 255, 170, 0.2)';
      });
      tag.addEventListener('mouseleave', function () {
        this.style.boxShadow = '';
      });
    });
  }

  /* ── 6. Observe DOM for new cards (inline editing adds cards) ── */
  function initMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1 && node.classList.contains('project-card')) {
            // Add neon bar to newly added card
            if (!node.querySelector('.neon-top-bar')) {
              const bar = document.createElement('div');
              bar.className = 'neon-top-bar';
              node.insertBefore(bar, node.firstChild);
            }
          }
        });
      });
    });

    const grid = document.querySelector('.projects-grid');
    if (grid) {
      observer.observe(grid, { childList: true, subtree: false });
    }
  }

  /* ── Public API ────────────────────────────────────────── */
  function init() {
    if (_active) return;
    _active = true;

    // Wait a tick for DOM to be ready
    requestAnimationFrame(() => {
      initGlitch();
      initCornerDecorators();
      initStatsTyping();
      initScanlineFlicker();
      initSkillHoverRipple();
      initMutationObserver();
    });
  }

  function destroy() {
    if (!_active) return;
    _active = false;

    // Clear all timers
    _intervals.forEach(clearInterval);
    _timeouts.forEach(clearTimeout);
    _intervals = [];
    _timeouts = [];

    // Remove injected elements
    const overlay = document.getElementById('cyberpunk-scanline-overlay');
    if (overlay) overlay.remove();

    // Remove neon bars
    document.querySelectorAll('.neon-top-bar').forEach(el => el.remove());
  }

  window.CyberpunkFX = { init, destroy };
})();
