/**
 * readme-analyzer.js
 * README Analyzer — Portfolio Generator
 *
 * Auth guard → File upload → Limit check → Edge function call → Render results
 * Dependencies: app.js (window.toast), auth.js (window.Auth, window._supabaseClient)
 */

;(function () {
  'use strict';

  /* ─── Sanitize fallback (in case app.js hasn't loaded) ─────────────── */
  const _sanitize = window.sanitize || function (str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  /* ─── State ────────────────────────────────────────────────────────── */
  let readmeContent     = null;   // نص الـ README المرفوع
  let currentUserId     = null;
  let _currentUser      = null;   // كائن المستخدم الكامل (module-level لاستخدامه في resetAnalyzer وغيرها)
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
    _currentUser  = user;   // حفظ الكائن الكامل لاستخدامه في resetAnalyzer وautoGenerateFromGitHub

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
    _initGitHubAutoBtn(user);   // GitHub auto-generate button + modal
  });

  /* ─────────────────────────────────────────────────────────────────────
     LOAD USER STATUS (Pro + usage count)
  ───────────────────────────────────────────────────────────────────── */
  async function _loadUserStatus(userId) {
    const sb = window._supabaseClient;
    if (!sb) return;

    // [MODIFIED] قراءة صف المستخدم مع retry — يحمي من race condition بعد upsert في auth.js
    // (صف الـ user الجديد قد لا يكون upsert اكتمل بعد، خصوصاً بعد Google login + Early Adopter grant)
    let data = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data: rowData, error: rErr } = await sb
        .from('users')
        .select('is_pro, readme_analyses_used')
        .eq('id', userId)
        .single();

      if (rowData) {
        data = rowData;
        break;
      }
      if (rErr && rErr.code !== 'PGRST116') {
        console.warn('[ReadmeAnalyzer] Unexpected error reading user row (attempt', attempt + 1, '):', rErr.message);
        break;
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 700));
    }

    if (!data) {
      console.warn('[ReadmeAnalyzer] Could not load user status after retries — proceeding with degraded state');
      // حافظ على سلوك الفشل الأصلي تماماً كما هو (return بدون تحديث isCurrentlyPro/usageData)
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
      window._autoReadmeContent = null;   // تنظيف auto state لو كان موجوداً
      window._autoReadmeLabel   = null;
      fileInput.value = '';
      filePill.classList.add('hidden');
      uploadZone.style.display  = '';
      uploadZone.style.opacity  = '1';   // إعادة opacity لو خُفِّفت عند auto load
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
      const content = e.target.result;
      if (!content || content.trim().length < 10) {
        window.toast('The file appears to be empty or too short to analyze.', 'error');
        return;
      }
      readmeContent = content;
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
      cb.addEventListener('change', () => {
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
    const hasFile    = !!(readmeContent || window._autoReadmeContent);
    const hasOutputs = _getSelectedOutputs().length > 0;
    generateBtn.disabled = !(hasFile && hasOutputs);
  }

  /* ─────────────────────────────────────────────────────────────────────
     GENERATE
  ───────────────────────────────────────────────────────────────────── */
  generateBtn.addEventListener('click', async () => {
    const effectiveContent = readmeContent || window._autoReadmeContent || null;

    if (!effectiveContent) {
      window.toast('Please upload a README file or use Auto Generate from GitHub', 'warn');
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

    await _runGeneration(selectedOutputs, effectiveContent);
  });

  async function _runGeneration(selectedOutputs, effectiveContent) {
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
          readmeContent:    effectiveContent,   // يدعم الرفع اليدوي والـ auto GitHub
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

      // ── Log analysis for all users (analytics)
      await sb.from('readme_analyses').insert({
        user_id:           currentUserId,
        outputs_requested: selectedOutputs,
        tokens_used:       data.tokensUsed || null,
      });

      // ── Increment usage counter for Free users only
      if (!isCurrentlyPro) {
        const newCount = usageData.used + 1;
        await sb
          .from('users')
          .update({ readme_analyses_used: newCount })
          .eq('id', currentUserId);

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
          ? 'You\'ve reached the usage limit. Upgrade to Pro for unlimited access.'
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

        // ── Header (Post N label + Copy button)
        const header = document.createElement('div');
        header.className = 'linkedin-post__header';

        const numSpan = document.createElement('span');
        numSpan.className   = 'linkedin-post__num';
        numSpan.textContent = `Post ${i + 1}`;

        const copyBtn = document.createElement('button');
        copyBtn.className   = 'btn btn--ghost btn--sm';
        copyBtn.textContent = 'Copy';
        // Fix 6: read from DOM at click-time, not from stale _postsRaw
        copyBtn.addEventListener('click', () => {
          const bodyEl = postEl.querySelector('.linkedin-post__body');
          const hashEl = postEl.querySelector('.linkedin-post__hashtags');
          const postContent = bodyEl ? (bodyEl.innerText || bodyEl.textContent || '') : '';
          const hashContent = hashEl ? (hashEl.innerText || hashEl.textContent || '') : '';
          const text = hashContent ? `${postContent}\n\n${hashContent}` : postContent;
          _copyToClipboard(text, copyBtn);
        });

        header.appendChild(numSpan);
        header.appendChild(copyBtn);

        // ── Body (Fix 2: textContent, not innerHTML)
        const bodyDiv = document.createElement('div');
        bodyDiv.className = 'linkedin-post__body';
        bodyDiv.id        = `post-body-${i}`;
        bodyDiv.textContent = postText;

        postEl.appendChild(header);
        postEl.appendChild(bodyDiv);

        // ── Hashtags
        if (hashtags) {
          const hashDiv = document.createElement('div');
          hashDiv.className   = 'linkedin-post__hashtags';
          hashDiv.textContent = hashtags;
          postEl.appendChild(hashDiv);
        }

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
    // ── State
    readmeContent = null;
    _postsRaw     = [];
    _skillsRaw    = [];

    // ── Auto-generate state (GitHub)
    window._autoReadmeContent = null;
    window._autoReadmeLabel   = null;

    // ── File UI
    fileInput.value = '';
    filePill.classList.add('hidden');
    uploadZone.style.display  = '';
    uploadZone.style.opacity  = '1';   // أُعيد لو كان خُفِّف عند auto load

    // ── GitHub hint text — أعد لقيمتها الأصلية بناءً على نوع المستخدم
    const hint = $('github-auto-hint');
    if (hint && _currentUser) {
      const isGithubUser = !!_currentUser.githubUsername;
      if (isGithubUser) {
        hint.textContent = `Will read READMEs from @${_currentUser.githubUsername}'s top repos`;
      } else {
        hint.textContent = 'Requires a linked GitHub account';
      }
    }

    // ── Results
    resultsSection.classList.remove('is-visible');
    ['block-bio','block-project','block-linkedin-posts','block-report','block-skills']
      .forEach(id => {
        const el = $(id);
        if (el) el.style.display = 'none';
      });

    // ── Clear content
    ['content-bio','content-project','content-report'].forEach(id => {
      const el = $(id);
      if (el) { el.textContent = ''; el.removeAttribute('contenteditable'); }
    });
    const skillsList = $('skills-list');
    if (skillsList) skillsList.innerHTML = '';
    const postsContainer = $('linkedin-posts-container');
    if (postsContainer) postsContainer.innerHTML = '';

    // ── Progress / spinner
    _hideProgress();
    _hideSpinner();

    // ── Generate button (لا يُفعَّل — لا ملف ولا auto content)
    generateBtn.disabled = true;

    // ── Scroll back to top
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

  /* ─────────────────────────────────────────────────────────────────────
     AUTO GENERATE FROM GITHUB REPOS
     يُستدعى عند ضغط زر "Auto Generate from GitHub Repos" من GitHub users
  ───────────────────────────────────────────────────────────────────── */
  async function autoGenerateFromGitHub(githubUsername) {
    // ── Null safety — هذا هو السبب الجذري لـ Bug 2 الأصلي
    if (!githubUsername || typeof githubUsername !== 'string' || !githubUsername.trim()) {
      window.toast('No GitHub username found. Please upload a README manually.', 'warn');
      return;
    }

    const btn  = $('github-auto-btn');
    const hint = $('github-auto-hint');

    // ── Loading state
    if (btn) {
      btn.disabled    = true;
      btn.textContent = 'Fetching repos…';
    }

    try {
      // ── التحقق من وجود window.GitHub قبل الاستدعاء
      if (!window.GitHub?.fetchGitHubData) {
        window.toast('GitHub module not loaded. Please refresh the page.', 'error');
        return;
      }

      // ── جلب بيانات GitHub (الـ in-memory cache يمنع طلبات مكررة)
      const ghData = await window.GitHub.fetchGitHubData(githubUsername);

      // ── استخراج أفضل repos التي لديها README
      // البنية الصحيحة: ghData.top_repos (وليس ghData.repos)
      const reposWithReadme = (ghData.top_repos || [])
        .filter(r => r.readme && r.readme.trim().length > 0)
        .slice(0, 3);

      if (reposWithReadme.length === 0) {
        window.toast('No READMEs found in your top repos. Please upload one manually.', 'warn');
        return;
      }

      // ── دمج READMEs — كل readme نص مقطوع 600 حرف بعد stripMarkdown
      const combinedContent = reposWithReadme
        .map(r => `# ${r.name}\n\n${r.readme}`)
        .join('\n\n---\n\n');

      const label = `GitHub: @${githubUsername} (${reposWithReadme.length} repo${reposWithReadme.length > 1 ? 's' : ''})`;

      // ── حقن المحتوى كـ "ملف مُحمَّل"
      window._autoReadmeContent = combinedContent;
      window._autoReadmeLabel   = label;

      // ── تحديث الـ UI
      if (fileNameEl) fileNameEl.textContent = label;
      if (filePill)   filePill.classList.remove('hidden');
      if (uploadZone) uploadZone.style.opacity = '0.4';   // خفِّف الـ upload zone (لا تُخفيها)
      if (hint)       hint.textContent = `✓ Loaded ${reposWithReadme.length} README${reposWithReadme.length > 1 ? 's' : ''} — hit Analyze to generate!`;

      _updateGenerateBtn();   // إعادة تقييم حالة الزر
      window.toast(`Loaded READMEs from ${reposWithReadme.length} repos. Hit Analyze!`, 'success');

    } catch (err) {
      console.error('[ReadmeAnalyzer] autoGenerateFromGitHub error:', err);

      // رسائل خطأ مناسبة لكل كود (GitHubError لها .code)
      const msg = err?.code === 'NOT_FOUND'
        ? 'GitHub profile not found.'
        : err?.code === 'RATE_LIMITED'
        ? 'GitHub API rate limit reached. Try again in a few minutes.'
        : err?.code === 'EMPTY_PROFILE'
        ? 'No public repos found. Upload a README manually.'
        : 'Failed to fetch GitHub data. Please upload a README manually.';

      window.toast(msg, 'error');

    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg> Auto Generate from GitHub Repos`;
      }
    }
  }

  /* ─────────────────────────────────────────────────────────────────────
     GITHUB AUTO BUTTON — wire-up في DOMContentLoaded
     (يُضاف بعد _initOutputCheckboxes() في الـ DOMContentLoaded handler)
  ───────────────────────────────────────────────────────────────────── */
  function _initGitHubAutoBtn(user) {
    const githubAutoBtn  = $('github-auto-btn');
    const githubAutoHint = $('github-auto-hint');

    if (!githubAutoBtn) return;   // الـ HTML لم يُحدَّث بعد — تجاهل آمن

    const isGithubUser = !!(user && user.githubUsername);

    // Hint text
    if (githubAutoHint && user) {
      githubAutoHint.textContent = isGithubUser
        ? `Will read READMEs from @${user.githubUsername}'s top repos`
        : 'Requires a linked GitHub account';
      githubAutoHint.style.display = 'block';
    }

    // Button click
    githubAutoBtn.addEventListener('click', async () => {
      if (!user) {
        window.location.href = _buildRelativeURL('index.html');
        return;
      }
      if (!isGithubUser) {
        // Google user → أظهر modal ربط GitHub
        $('connect-github-modal')?.classList.remove('hidden');
        return;
      }
      await autoGenerateFromGitHub(user.githubUsername);
    });

    // Connect GitHub button في الـ modal
    $('connect-github-btn')?.addEventListener('click', () => {
      window.Auth?.signIn?.();
    });

    // Backdrop click لإغلاق الـ modal
    $('connect-github-modal')?.addEventListener('click', e => {
      if (e.target === $('connect-github-modal')) {
        $('connect-github-modal').classList.add('hidden');
      }
    });
  }

})();
