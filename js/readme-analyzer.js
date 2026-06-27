/**
 * readme-analyzer.js
 * README Analyzer — Portfolio Generator
 *
 * Auth guard → File upload → Limit check → Edge function call → Render results
 * Dependencies: app.js (window.toast), auth.js (window.Auth, window._supabaseClient)
 */

;(function () {
  'use strict';

  /* ─── State ────────────────────────────────────────────────────────── */
  let readmeContent     = null;   // نص الـ README المرفوع
  let currentUserId     = null;
  let isCurrentlyPro    = false;
  let usageData         = { used: 0, remaining: 3, allowed: true };
  let _skillsRaw        = [];     // للـ "Copy" زر الـ skills
  let _postsRaw         = [];     // للـ "Copy All" زر الـ posts

  /* ─── DOM refs ─────────────────────────────────────────────────────── */
  const $ = id => document.getElementById(id);

  const uploadZone    = $('upload-zone');
  const fileInput     = $('file-input');
  const filePill      = $('file-pill');
  const fileNameEl    = $('file-name');
  const removeFileBtn = $('remove-file');
  const generateBtn   = $('generate-btn');
  const usageBar      = $('usage-bar');
  const usageRemEl    = $('usage-remaining');
  const progressWrap  = $('progress-wrap');
  const progressBar   = $('progress-bar');
  const resultsSection = $('results-section');
  const spinnerOverlay = $('spinner-overlay');
  const spinnerLabel   = $('spinner-label');
  const paywallModal   = $('paywall-modal');

  /* ─────────────────────────────────────────────────────────────────────
     AUTH GUARD
     نفس نمط dashboard.html — لو مش logged in يروح index.html
  ───────────────────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', async () => {
    // Supabase بيتشغل في auth.js قبل كده — نستنى الـ session
    const user = await Auth.getUser();

    if (!user) {
      window.location.href = _buildRelativeURL('index.html');
      return;
    }

    currentUserId = user.id;

    // Update nav avatar (نفس نمط auth.js _updateNav)
    const avatarEl   = document.querySelector('[data-nav-avatar]');
    const signOutBtn = document.querySelector('[data-nav-signout]');
    if (avatarEl)   { avatarEl.src = user.avatarUrl; avatarEl.classList.remove('hidden'); }
    if (signOutBtn) signOutBtn.classList.remove('hidden');

    // جيب Pro status + usage
    await _loadUserStatus(user.id);

    // Wire up events
    _initUploadZone();
    _initOutputCheckboxes();
  });

  /* ─────────────────────────────────────────────────────────────────────
     LOAD USER STATUS (Pro + usage count)
  ───────────────────────────────────────────────────────────────────── */
  async function _loadUserStatus(userId) {
    const sb = window._supabaseClient;
    if (!sb) return;

    const { data, error } = await sb
      .from('users')
      .select('is_pro, readme_analyses_used')
      .eq('id', userId)
      .single();

    if (error) {
      console.warn('[ReadmeAnalyzer] Could not load user status:', error.message);
      return;
    }

    isCurrentlyPro = data?.is_pro === true;
    const used     = data?.readme_analyses_used || 0;
    const limit    = 3;

    usageData = {
      used,
      remaining: Math.max(0, limit - used),
      allowed:   used < limit,
    };

    // Show usage bar only to Free users
    if (!isCurrentlyPro) {
      if (usageRemEl) usageRemEl.textContent = usageData.remaining;
      if (usageBar)   usageBar.style.display = 'flex';
    }
  }

  /* ─────────────────────────────────────────────────────────────────────
     UPLOAD ZONE
  ───────────────────────────────────────────────────────────────────── */
  function _initUploadZone() {
    if (!fileInput) return;

    // Click anywhere in the zone → trigger file picker
    // (the <input> covers the zone via position:absolute)
    fileInput.addEventListener('change', _onFileSelected);

    // Drag & drop
    uploadZone.addEventListener('dragover', e => {
      e.preventDefault();
      uploadZone.classList.add('drag-over');
    });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
    uploadZone.addEventListener('drop', e => {
      e.preventDefault();
      uploadZone.classList.remove('drag-over');
      const file = e.dataTransfer?.files[0];
      if (file) _processFile(file);
    });

    // Remove button
    removeFileBtn?.addEventListener('click', () => {
      readmeContent = null;
      fileInput.value = '';
      filePill.classList.add('hidden');
      uploadZone.style.display = '';
      _updateGenerateBtn();
    });
  }

  function _onFileSelected(e) {
    const file = e.target.files[0];
    if (file) _processFile(file);
  }

  function _processFile(file) {
    // Validate extension
    if (!file.name.toLowerCase().endsWith('.md')) {
      window.toast('Please upload a .md file only', 'error');
      return;
    }
    // Validate size (500KB)
    if (file.size > 500 * 1024) {
      window.toast('File too large — max 500KB', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = e => {
      readmeContent = e.target.result;
      _showFilePill(file.name);
    };
    reader.onerror = () => window.toast('Could not read file', 'error');
    reader.readAsText(file);
  }

  function _showFilePill(name) {
    fileNameEl.textContent  = name;
    filePill.classList.remove('hidden');
    uploadZone.style.display = 'none';
    _updateGenerateBtn();
  }

  /* ─────────────────────────────────────────────────────────────────────
     CHECKBOX TOGGLES
  ───────────────────────────────────────────────────────────────────── */
  function _initOutputCheckboxes() {
    document.querySelectorAll('.output-option').forEach(label => {
      const cb = label.querySelector('input[type="checkbox"]');
      label.addEventListener('click', () => {
        cb.checked = !cb.checked;
        label.classList.toggle('is-checked', cb.checked);
        _updateGenerateBtn();
      });
    });
  }

  function _getSelectedOutputs() {
    return [...document.querySelectorAll('.output-option.is-checked')]
      .map(el => el.dataset.key);
  }

  function _updateGenerateBtn() {
    const hasFile    = !!readmeContent;
    const hasOutputs = _getSelectedOutputs().length > 0;
    generateBtn.disabled = !(hasFile && hasOutputs);
  }

  /* ─────────────────────────────────────────────────────────────────────
     GENERATE
  ───────────────────────────────────────────────────────────────────── */
  generateBtn.addEventListener('click', async () => {
    if (!readmeContent) {
      window.toast('Please upload a README file first', 'warn');
      return;
    }

    const selectedOutputs = _getSelectedOutputs();
    if (!selectedOutputs.length) {
      window.toast('Select at least one output type', 'warn');
      return;
    }

    // Limit check for Free users
    if (!isCurrentlyPro) {
      if (!usageData.allowed) {
        _showPaywall();
        return;
      }
    }

    await _runGeneration(selectedOutputs);
  });

  async function _runGeneration(selectedOutputs) {
    const sb = window._supabaseClient;
    if (!sb) {
      window.toast('Not connected — please refresh', 'error');
      return;
    }

    // ── UI: loading state
    generateBtn.disabled = true;
    _showSpinner('Analyzing README…');
    _showProgress(0);

    try {
      // Animate progress to ~70% while waiting for the edge function
      _animateProgress(70, 8000);

      // ── Call edge function
      const { data, error } = await sb.functions.invoke('readme-analyze', {
        body: {
          readmeContent,
          requestedOutputs: selectedOutputs,
          userId: currentUserId,
        },
      });

      if (error) {
        throw new Error(error.message || 'Edge function returned an error');
      }
      if (!data?.outputs) {
        throw new Error('Unexpected response format from server');
      }

      // ── Progress: done
      _animateProgress(100, 400);
      await _sleep(500);

      // ── Increment usage counter for Free users
      if (!isCurrentlyPro) {
        const newCount = usageData.used + 1;
        await sb
          .from('users')
          .update({ readme_analyses_used: newCount })
          .eq('id', currentUserId);

        // Log to readme_analyses table
        await sb.from('readme_analyses').insert({
          user_id:           currentUserId,
          outputs_requested: selectedOutputs,
          tokens_used:       data.tokensUsed || null,
        });

        // Update local state
        usageData.used      = newCount;
        usageData.remaining = Math.max(0, 3 - newCount);
        usageData.allowed   = newCount < 3;
        if (usageRemEl) usageRemEl.textContent = usageData.remaining;
      }

      // ── Render results
      _renderResults(data.outputs, selectedOutputs);
      window.toast('Generated successfully ✓', 'success');

    } catch (err) {
      console.error('[ReadmeAnalyzer] Generation error:', err);
      window.toast(
        err.message?.includes('RATE_LIMITED')
          ? 'You've reached the usage limit. Upgrade to Pro for unlimited access.'
          : 'Generation failed — please try again',
        'error'
      );
    } finally {
      _hideSpinner();
      _hideProgress();
      generateBtn.disabled = false;
      _updateGenerateBtn(); // re-check state
    }
  }

  /* ─────────────────────────────────────────────────────────────────────
     RENDER RESULTS
  ───────────────────────────────────────────────────────────────────── */
  function _renderResults(outputs, selectedOutputs) {
    // Show results section
    resultsSection.classList.add('is-visible');

    // Scroll to results
    setTimeout(() => resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);

    // Update badge
    $('results-badge').textContent =
      `${selectedOutputs.length} output${selectedOutputs.length !== 1 ? 's' : ''} generated`;

    // ── Bio
    if (outputs.bio) {
      $('content-bio').textContent = outputs.bio;
      $('block-bio').style.display = '';
    }

    // ── Project description
    if (outputs.project) {
      $('content-project').textContent = outputs.project;
      $('block-project').style.display = '';
    }

    // ── LinkedIn posts
    if (outputs.linkedin_posts) {
      const postsWrap = $('linkedin-posts-container');
      postsWrap.innerHTML = '';
      _postsRaw = [];

      // The edge function returns an array of {post, hashtags} or plain strings
      const posts = Array.isArray(outputs.linkedin_posts)
        ? outputs.linkedin_posts
        : [outputs.linkedin_posts];

      posts.forEach((item, i) => {
        const postText  = typeof item === 'string' ? item : (item.post || '');
        const hashtags  = typeof item === 'object' && Array.isArray(item.hashtags)
          ? item.hashtags.map(h => (h.startsWith('#') ? h : `#${h}`)).join(' ')
          : '';
        const fullText  = hashtags ? `${postText}\n\n${hashtags}` : postText;
        _postsRaw.push(fullText);

        const postEl = document.createElement('div');
        postEl.className = 'linkedin-post';
        postEl.innerHTML = `
          <div class="linkedin-post__header">
            <span class="linkedin-post__num">Post ${i + 1}</span>
            <button class="btn btn--ghost btn--sm"
                    onclick="copyPostByIndex(${i}, this)">Copy</button>
          </div>
          <div class="linkedin-post__body" id="post-body-${i}">${window.sanitize(postText)}</div>
          ${hashtags ? `<div class="linkedin-post__hashtags">${window.sanitize(hashtags)}</div>` : ''}
        `;
        postsWrap.appendChild(postEl);
      });

      $('block-linkedin-posts').style.display = '';
    }

    // ── LinkedIn presence report
    if (outputs.report) {
      // report can be a string or an object — normalise to readable text
      const reportText = typeof outputs.report === 'string'
        ? outputs.report
        : JSON.stringify(outputs.report, null, 2);
      $('content-report').textContent = reportText;
      $('block-report').style.display = '';
    }

    // ── Skills
    if (outputs.skills) {
      const skillsArr = Array.isArray(outputs.skills)
        ? outputs.skills
        : String(outputs.skills).split(/,\s*/);

      _skillsRaw = skillsArr;
      const list = $('skills-list');
      list.innerHTML = '';
      skillsArr.forEach(skill => {
        const chip = document.createElement('span');
        chip.className   = 'skill-chip';
        chip.textContent = skill.trim();
        list.appendChild(chip);
      });
      $('block-skills').style.display = '';
    }
  }

  /* ─────────────────────────────────────────────────────────────────────
     COPY HELPERS  (exposed to window for onclick attributes in HTML)
  ───────────────────────────────────────────────────────────────────── */

  /**
   * Copy text content of an element (supports contenteditable too)
   */
  window.copyContent = function (elementId, btn) {
    const el = $(elementId);
    if (!el) return;
    const text = el.innerText || el.textContent || '';
    _copyToClipboard(text, btn);
  };

  /**
   * Copy a single LinkedIn post by index
   */
  window.copyPostByIndex = function (index, btn) {
    const text = _postsRaw[index] || '';
    _copyToClipboard(text, btn);
  };

  /**
   * Copy all LinkedIn posts concatenated
   */
  window.copyAllPosts = function () {
    const text = _postsRaw.join('\n\n---\n\n');
    const btn  = $('copy-all-posts-btn');
    _copyToClipboard(text, btn);
  };

  /**
   * Copy skills as comma-separated list
   */
  window.copySkills = function () {
    const text = _skillsRaw.join(', ');
    const btn  = $('copy-skills-btn');
    _copyToClipboard(text, btn);
  };

  function _copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      if (btn) {
        const original = btn.textContent;
        btn.textContent = '✓ Copied!';
        btn.classList.add('btn--copied');
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove('btn--copied');
        }, 2000);
      }
      window.toast('Copied to clipboard ✓', 'success');
    }).catch(() => {
      window.toast('Copy failed — try selecting manually', 'error');
    });
  }

  /* ─────────────────────────────────────────────────────────────────────
     EDIT TOGGLE
     يحوّل div المحتوى لـ contenteditable مؤقتاً
  ───────────────────────────────────────────────────────────────────── */
  window.toggleEdit = function (btn, elementId) {
    const el = $(elementId);
    if (!el) return;

    const isEditing = el.getAttribute('contenteditable') === 'true';

    if (isEditing) {
      el.setAttribute('contenteditable', 'false');
      btn.textContent = 'Edit';
    } else {
      el.setAttribute('contenteditable', 'true');
      btn.textContent = 'Done';
      el.focus();
      // Move cursor to end
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    }
  };

  /* ─────────────────────────────────────────────────────────────────────
     RESET — بدون reload
  ───────────────────────────────────────────────────────────────────── */
  window.resetAnalyzer = function () {
    // State
    readmeContent = null;
    _postsRaw     = [];
    _skillsRaw    = [];

    // File
    fileInput.value = '';
    filePill.classList.add('hidden');
    uploadZone.style.display = '';

    // Results
    resultsSection.classList.remove('is-visible');
    ['block-bio','block-project','block-linkedin-posts','block-report','block-skills']
      .forEach(id => {
        const el = $(id);
        if (el) el.style.display = 'none';
      });

    // Clear content
    ['content-bio','content-project','content-report'].forEach(id => {
      const el = $(id);
      if (el) { el.textContent = ''; el.removeAttribute('contenteditable'); }
    });
    const skillsList = $('skills-list');
    if (skillsList) skillsList.innerHTML = '';
    const postsContainer = $('linkedin-posts-container');
    if (postsContainer) postsContainer.innerHTML = '';

    // Progress / spinner
    _hideProgress();
    _hideSpinner();

    // Disable generate button (no file)
    generateBtn.disabled = true;

    // Scroll back to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /* ─────────────────────────────────────────────────────────────────────
     PAYWALL
  ───────────────────────────────────────────────────────────────────── */
  function _showPaywall() {
    paywallModal.classList.remove('hidden');
  }

  window.closePaywall = function () {
    paywallModal.classList.add('hidden');
  };

  // Close on backdrop click
  paywallModal?.addEventListener('click', e => {
    if (e.target === paywallModal) window.closePaywall();
  });

  /* ─────────────────────────────────────────────────────────────────────
     PROGRESS BAR HELPERS
  ───────────────────────────────────────────────────────────────────── */
  let _progressInterval = null;

  function _showProgress(pct) {
    progressWrap.style.display = '';
    progressBar.style.width    = `${pct}%`;
  }

  function _hideProgress() {
    if (_progressInterval) clearInterval(_progressInterval);
    _progressInterval = null;
    progressWrap.style.display = 'none';
    progressBar.style.width    = '0%';
  }

  /**
   * Animate progress bar from current value up to `target` over `durationMs`
   */
  function _animateProgress(target, durationMs) {
    if (_progressInterval) clearInterval(_progressInterval);
    const startPct = parseFloat(progressBar.style.width) || 0;
    const steps    = 40;
    const stepMs   = durationMs / steps;
    const increment = (target - startPct) / steps;
    let current    = startPct;

    _progressInterval = setInterval(() => {
      current += increment;
      if (current >= target) {
        current = target;
        clearInterval(_progressInterval);
        _progressInterval = null;
      }
      progressBar.style.width = `${current}%`;
    }, stepMs);
  }

  /* ─────────────────────────────────────────────────────────────────────
     SPINNER
  ───────────────────────────────────────────────────────────────────── */
  function _showSpinner(msg = 'Analyzing…') {
    if (spinnerLabel) spinnerLabel.textContent = msg;
    spinnerOverlay.classList.add('is-visible');
  }

  function _hideSpinner() {
    spinnerOverlay.classList.remove('is-visible');
  }

  /* ─────────────────────────────────────────────────────────────────────
     UTILITIES
  ───────────────────────────────────────────────────────────────────── */
  function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function _buildRelativeURL(page) {
    const base = window.location.pathname.replace(/\/[^/]*$/, '/');
    return window.location.origin + base + page;
  }

})();
