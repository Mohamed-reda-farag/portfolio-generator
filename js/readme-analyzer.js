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
  // [FIXED] إعادة تصميم مشكلة 2: كان فيه نص واحد مُدمج (readmeContent) —
  // بقى مصفوفة عناصر مسمّاة {name, content}، كل عنصر = مشروع مستقل، عشان
  // edge function يقدر يطلع وصف/بوست مستقل لكل مشروع بدل نتيجة واحدة مدموجة.
  let _uploadedItems    = [];     // [{ name, content }] — من الرفع اليدوي
  let currentUserId     = null;
  let _currentUser      = null;   // كائن المستخدم الكامل (module-level لاستخدامه في resetAnalyzer وغيرها)
  let isCurrentlyPro    = false;
  let usageData         = { used: 0, remaining: 3, allowed: true };
  let _skillsRaw        = [];     // للـ "Copy" زر الـ skills
  let _postsRaw         = [];     // للـ "Copy All" زر الـ posts
  const MAX_UPLOAD_FILES = 5;     // حد أعلى معقول لعدد الملفات في الرفعة الواحدة

  /* ─── DOM refs ─────────────────────────────────────────────────────── */
  const $ = id => document.getElementById(id);

  const uploadZone     = $('upload-zone');
  const fileInput      = $('file-input');
  const itemsList      = $('items-list');   // [MODIFIED] كان file-pill واحد مُجمّع — بقى container لعدة chips مستقلة
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
      // [FIXED] كان بياخد أول ملف بس (files[0]) — دلوقتي بيمرر كل الملفات
      const files = e.dataTransfer?.files;
      if (files && files.length) _processFiles([...files]);
    });

    // [MODIFIED] زر "مسح الكل" وزر "+ Add" الثابتين اتشالوا — دلوقتي كل
    // چيب بيتعرض ليه زر ✕ خاص بيه (شوف _renderItemChips)، وزر "+ Add"
    // بيتولّد ديناميكيًا جوه نفس الدالة عشان يفضل آخر عنصر في القايمة.
  }

  function _onFileSelected(e) {
    // [FIXED] كان بياخد أول ملف بس (files[0]) من غير ما يدعم رفع كذا ملف
    // مرة واحدة. دلوقتي بيمرر كل الملفات المختارة لـ _processFiles.
    const files = e.target.files;
    if (files && files.length) _processFiles([...files]);
    // [FIXED] لازم نصفّر الـ input فورًا (مش بعد الـ async processing) —
    // عشان لو المستخدم ضغط "+ Add" واختار نفس اسم الملف تاني، الـ change
    // event يتفعّل تاني بدل ما يفضل ساكت لأن القيمة متكررة.
    e.target.value = '';
  }

  /**
   * [FIXED] مشكلة 2-أ — كانت _processFile (مفرد) بتاخد ملف واحد بس.
   * دلوقتي _processFiles (جمع) بتقبل كذا ملف: تتحقق من كل ملف على حدة
   * (امتداد .md + حجم أقصى 500KB)، تتجاهل غير الصالح مع تنبيه، تقرأ
   * الباقي، وتخليهم مصفوفة عناصر مستقلة {name, content} — كل ملف مشروع
   * قائم بذاته يُبعت لـ edge function عشان يطلع وصف/بوست مستقل لكل واحد.
   */
  async function _processFiles(files) {
    // [FIXED] الحد الأقصى بقى على الإجمالي (الموجود + الجديد) — مش على
    // الدفعة الجديدة لوحدها — عشان زر "+ Add" يحسب صح مع الملفات المُضافة قبل كده
    const remainingSlots = MAX_UPLOAD_FILES - _uploadedItems.length;
    if (remainingSlots <= 0) {
      window.toast(`You can upload up to ${MAX_UPLOAD_FILES} files total — remove one first to add another.`, 'warn');
      return;
    }
    if (files.length > remainingSlots) {
      window.toast(`Only ${remainingSlots} more file(s) can be added (max ${MAX_UPLOAD_FILES} total) — using the first ${remainingSlots}.`, 'warn');
      files = files.slice(0, remainingSlots);
    }

    // ── تحقق من كل ملف على حدة؛ نتجاهل غير الصالح ونكمل بالباقي
    //
    // [FIXED] السبب الجذري لباج "بيتخطى الملفات اللي نفس الاسم": أغلب
    // مشاريع الـ README فعليًا اسم ملفها "README.md" حرفيًا، فكان بيتحسب
    // "نفس الملف" ويتجاهَل ("already added") رغم إنه محتوى مختلف تمامًا
    // من مشروع مختلف — وده كان بيسقّط كل الملفات إلا أول واحد بصمت. الأخطر:
    // حتى لو الفلترة دي اتشالت من غير بديل، الاسم المكرر ده كان هيتبعت زي
    // ما هو لـ edge function (readme-analyze) اللي بتستخدم item.name كمعرّف
    // فريد لكل مشروع جوه الـ prompt نفسه (`---BEGIN PROJECT: "README.md"---`
    // مكرر لكل ملف) — فالموديل مش هيقدر يميّز المشاريع عن بعض أصلاً حتى لو
    // اتبعتوا. الحل: بدل رفض الملف المكرر الاسم، نديله اسم فريد تلقائيًا
    // (راجع _uniqueItemName) — فكل مشروع يفضل عنصر مستقل بالاسم فعليًا من
    // أول لحظة، ومفيش أي ملف بيتحذف بصمت.
    const existingNames = new Set(_uploadedItems.map(r => r.name));
    const validFiles = [];
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.md')) {
        window.toast(`"${file.name}" skipped — only .md files are supported`, 'error');
        continue;
      }
      if (file.size > 500 * 1024) {
        window.toast(`"${file.name}" skipped — max 500KB per file`, 'error');
        continue;
      }
      const uniqueName = _uniqueItemName(file, existingNames);
      existingNames.add(uniqueName); // نحدّث فورًا عشان نتعامل صح مع أكتر من ملف بنفس الاسم في نفس الدفعة
      validFiles.push({ file, uniqueName });
    }

    if (!validFiles.length) return;

    try {
      const readResults = await Promise.all(
        validFiles.map(({ file, uniqueName }) => _readFileAsText(file, uniqueName))
      );

      // نفس الحد الأدنى القديم: نتجاهل أي ملف فاضي أو أقصر من 10 حروف
      const usable = readResults.filter(r => r.content && r.content.trim().length >= 10);
      if (!usable.length) {
        window.toast('The file(s) appear to be empty or too short to analyze.', 'error');
        return;
      }

      // [FIXED] append بدل replace — كل ملف يفضل عنصر مستقل بالاسم
      // [MODIFIED] بنعلّم مصدر العنصر ('upload') عشان الچيب يعرض أيقونة
      // مناسبة، وبقى مُوحَّد مع عناصر GitHub جوه نفس المصفوفة _uploadedItems
      _uploadedItems = [..._uploadedItems, ...usable.map(it => ({ ...it, source: 'upload' }))];
      _renderItemChips();

    } catch (err) {
      console.error('[ReadmeAnalyzer] Failed to read file(s):', err);
      window.toast('Could not read one or more files', 'error');
    }
  }

  function _readFileAsText(file, nameOverride) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve({ name: nameOverride || file.name, content: e.target.result });
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsText(file);
    });
  }

  /**
   * [FIXED] راجع الشرح الكامل عند نداءها في _processFiles فوق. بتديله اسم
   * فريد لأي ملف اسمه متكرر (زي "README.md" جاي من أكتر من مشروع) بدل ما
   * نرفضه — بنستخدم اسم الفولدر لو الملف جاي من رفع فولدر كامل
   * (webkitRelativePath متاح ساعتها)، وإلا رقم تسلسلي بسيط.
   *
   * @param {File} file
   * @param {Set<string>} existingNames — الأسماء المحجوزة بالفعل (بيتحدّث بره الدالة دي)
   * @returns {string}
   */
  function _uniqueItemName(file, existingNames) {
    const relPath = file.webkitRelativePath || '';
    const folder  = relPath.includes('/') ? relPath.split('/').slice(-2, -1)[0] : '';
    const original = folder ? `${folder}/${file.name}` : file.name;
    return _makeUniqueName(original, existingNames);
  }

  /**
   * [MODIFIED] المُنطق العام لتوليد اسم فريد (رقم تسلسلي "(2)", "(3)"...
   * محافظًا على الامتداد لو موجود) — مُستخرَج من _uniqueItemName القديمة
   * عشان يُستخدم كمان لعناصر GitHub (اللي اسمها repo name، مش File)، بدل
   * ما يتكرر نفس المنطق في مكانين.
   *
   * @param {string} name
   * @param {Set<string>} existingNames
   * @returns {string}
   */
  function _makeUniqueName(name, existingNames) {
    if (!existingNames.has(name)) return name;

    const dot  = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext  = dot > 0 ? name.slice(dot)     : '';

    let n = 2;
    let candidate = `${base} (${n})${ext}`;
    while (existingNames.has(candidate)) {
      n++;
      candidate = `${base} (${n})${ext}`;
    }
    return candidate;
  }

  /**
   * [MODIFIED] بديل _showFilePill — بدل pill واحد مُجمّع، بترسم چيب مستقل
   * لكل عنصر في _uploadedItems (سواء ملف مرفوع يدويًا أو README من GitHub)
   * بزر ✕ خاص بيه (_removeItem)، بالإضافة لچيب "+ Add" في الآخر لإضافة
   * ملف تاني. لو القايمة فاضية، ترجع upload-zone تظهر تاني.
   */
  function _renderItemChips() {
    itemsList.innerHTML = '';

    _uploadedItems.forEach((item, i) => {
      const chip = document.createElement('div');
      chip.className = 'item-chip';

      const icon = document.createElement('span');
      icon.className = 'item-chip__icon';
      icon.textContent = item.source === 'github' ? '🐙' : '📄';

      const name = document.createElement('span');
      name.className = 'item-chip__name';
      name.textContent = item.name;
      name.title = item.name;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'item-chip__remove';
      removeBtn.title = `Remove "${item.name}"`;
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => _removeItem(i));

      chip.appendChild(icon);
      chip.appendChild(name);
      chip.appendChild(removeBtn);
      itemsList.appendChild(chip);
    });

    // ── چيب "+ Add" — بيفتح نفس الـ file picker، متاح طالما لسه فيه مكان
    if (_uploadedItems.length < MAX_UPLOAD_FILES) {
      const addBtn = document.createElement('button');
      addBtn.className = 'item-chip--add';
      addBtn.title = 'Add another file';
      addBtn.textContent = '+ Add';
      addBtn.addEventListener('click', () => fileInput.click());
      itemsList.appendChild(addBtn);
    }

    const hasItems = _uploadedItems.length > 0;
    itemsList.classList.toggle('hidden', !hasItems);
    uploadZone.style.display = hasItems ? 'none' : '';
    uploadZone.style.opacity = '1';

    _updateGenerateBtn();
  }

  /**
   * [MODIFIED] الوظيفة الأساسية المطلوبة هنا — تشيل مشروع واحد بذاته من
   * _uploadedItems (بغض النظر عن مصدره) من غير ما تأثر على الباقي، بدل
   * الاضطرار لمسح كل حاجة وإعادة الرفع/الجلب من الأول.
   * @param {number} index
   */
  function _removeItem(index) {
    _uploadedItems = _uploadedItems.filter((_, i) => i !== index);
    _renderItemChips();
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
    // [MODIFIED] كل العناصر (رفع يدوي + GitHub) بقت في نفس المصفوفة
    // _uploadedItems — مفيش داعي بعد كده لفحص window._autoReadmeItems منفصل
    const hasFile    = _uploadedItems.length > 0;
    const hasOutputs = _getSelectedOutputs().length > 0;
    generateBtn.disabled = !(hasFile && hasOutputs);
  }

  /* ─────────────────────────────────────────────────────────────────────
     GENERATE
  ───────────────────────────────────────────────────────────────────── */
  generateBtn.addEventListener('click', async () => {
    // [MODIFIED] _uploadedItems بقت المصدر الوحيد (رفع يدوي + GitHub مع بعض)
    const effectiveItems = _uploadedItems;

    if (!effectiveItems.length) {
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

    await _runGeneration(selectedOutputs, effectiveItems);
  });

  async function _runGeneration(selectedOutputs, effectiveItems) {
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
      // [FIXED] readmeItems بدل readmeContent — يدعم الرفع اليدوي والـ auto
      // GitHub بنفس الشكل، وبيسمح لـ edge function يميّز بين المشاريع
      const { data, error } = await sb.functions.invoke('readme-analyze', {
        body: {
          readmeItems:      effectiveItems,
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

    // ── Project descriptions
    // [FIXED] كان outputs.project (وصف واحد بس، فعليًا وصف أول مشروع بس
    // مهما كان عدد الملفات/الـ repos المُرسلة). بقى outputs.projects
    // (مصفوفة) — بلوك مستقل لكل مشروع بالاسم.
    if (outputs.projects && outputs.projects.length) {
      const container = $('projects-container');
      container.innerHTML = '';

      outputs.projects.forEach((proj, i) => {
        const name = proj?.name || `Project ${i + 1}`;
        const desc = proj?.description || '';
        const contentId = `content-project-${i}`;

        if (i > 0) {
          const divider = document.createElement('hr');
          divider.className = 'result-divider';
          container.appendChild(divider);
        }

        const block = document.createElement('div');
        block.className = 'result-block';

        const header = document.createElement('div');
        header.className = 'result-block__header';

        const title = document.createElement('div');
        title.className = 'result-block__title';
        title.textContent = `💼 ${name}`;

        const actions = document.createElement('div');
        actions.className = 'result-block__actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn--ghost btn--sm';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => window.toggleEdit(editBtn, contentId));

        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn btn--ghost btn--sm';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', () => window.copyContent(contentId, copyBtn));

        actions.appendChild(editBtn);
        actions.appendChild(copyBtn);
        header.appendChild(title);
        header.appendChild(actions);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'result-content';
        contentDiv.id = contentId;
        contentDiv.textContent = desc;

        block.appendChild(header);
        block.appendChild(contentDiv);
        container.appendChild(block);
      });

      $('block-projects').style.display = '';
    }

    // ── LinkedIn posts
    if (outputs.linkedin_posts) {
      const postsWrap = $('linkedin-posts-container');
      postsWrap.innerHTML = '';
      _postsRaw = [];

      // The edge function returns an array of {project, post, hashtags} (new)
      // or {post, hashtags} / plain strings (old shape — توافق رجعي)
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

        // ── Header (project name label + Copy button)
        const header = document.createElement('div');
        header.className = 'linkedin-post__header';

        const numSpan = document.createElement('span');
        numSpan.className   = 'linkedin-post__num';
        // [FIXED] كان "Post N" ثابت — بقى بيعرض اسم المشروع اللي البوست
        // عنه لو متوفر (الشكل الجديد)، وبيرجع لـ "Post N" كـ fallback
        // للتوافق الرجعي مع الشكل القديم.
        numSpan.textContent = (typeof item === 'object' && item.project) ? `🔗 ${item.project}` : `Post ${i + 1}`;

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

    // ── LinkedIn Optimization Report
    // [MODIFIED] كانت بتتحط كـ JSON.stringify خام جوه نص عادي — المستخدم
    // كان بيشوف بريكتس وquotes حرفيًا بدل تقرير مقروء، رغم إن الـ backend
    // فعليًا بيرجّع 5 حقول منظّمة (score/strengths/keywords/benchmark/tips).
    // _renderReport() بتوزّع كل حقل في قسمه المناسب بدل تفريغهم كنص واحد.
    if (outputs.report) {
      _renderReport(outputs.report);
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

  /**
   * [MODIFIED] عرض منظّم لـ LinkedIn Optimization Report بدل JSON.stringify
   * خام. الشكل المتوقع من edge function (راجع OUTPUT_PROMPTS.report في
   * readme-analyze/index.ts):
   *   { profile_strength_score, key_strengths[], recommended_keywords[],
   *     industry_benchmark, improvement_tips[] }
   * لو الشكل مختلف عن المتوقع (مفيش أي حقل معروف)، بنرجع لعرض الـ JSON
   * الخام كـ fallback أخير — أهم من إخفاء البيانات تمامًا.
   * @param {any} report
   */
  function _renderReport(report) {
    const container = $('content-report');
    container.innerHTML = '';

    if (typeof report === 'string') {
      container.textContent = report;
      return;
    }

    const score = Number(report?.profile_strength_score);
    if (Number.isFinite(score)) {
      const color = score >= 75 ? 'var(--clr-accent)' : score >= 50 ? 'var(--clr-warn)' : 'var(--clr-error)';

      const scoreWrap = document.createElement('div');
      scoreWrap.className = 'report-score';

      const ring = document.createElement('div');
      ring.className = 'report-score__ring';
      ring.style.borderColor = color;
      ring.style.color = color;
      ring.textContent = Math.round(score);

      const label = document.createElement('div');
      const labelTop = document.createElement('div');
      labelTop.className = 'report-score__label';
      labelTop.textContent = 'Profile Strength Score';
      const labelVal = document.createElement('div');
      labelVal.className = 'report-score__value';
      labelVal.textContent = `${Math.round(score)} / 100`;
      label.appendChild(labelTop);
      label.appendChild(labelVal);

      scoreWrap.appendChild(ring);
      scoreWrap.appendChild(label);
      container.appendChild(scoreWrap);
    }

    const addListSection = (title, items) => {
      if (!Array.isArray(items) || !items.length) return;
      const section = document.createElement('div');
      section.className = 'report-section';

      const h = document.createElement('div');
      h.className = 'report-section__title';
      h.textContent = title;

      const ul = document.createElement('ul');
      ul.className = 'report-list';
      items.forEach(txt => {
        const li = document.createElement('li');
        li.textContent = txt;
        ul.appendChild(li);
      });

      section.appendChild(h);
      section.appendChild(ul);
      container.appendChild(section);
    };

    addListSection('Key Strengths', report?.key_strengths);

    if (Array.isArray(report?.recommended_keywords) && report.recommended_keywords.length) {
      const section = document.createElement('div');
      section.className = 'report-section';

      const h = document.createElement('div');
      h.className = 'report-section__title';
      h.textContent = 'Recommended LinkedIn Keywords';

      const wrap = document.createElement('div');
      wrap.className = 'report-keywords';
      report.recommended_keywords.forEach(kw => {
        const chip = document.createElement('span');
        chip.className = 'skill-chip';
        chip.textContent = kw;
        wrap.appendChild(chip);
      });

      section.appendChild(h);
      section.appendChild(wrap);
      container.appendChild(section);
    }

    if (report?.industry_benchmark) {
      const section = document.createElement('div');
      section.className = 'report-section';

      const h = document.createElement('div');
      h.className = 'report-section__title';
      h.textContent = 'Industry Benchmark';

      const p = document.createElement('p');
      p.textContent = report.industry_benchmark;

      section.appendChild(h);
      section.appendChild(p);
      container.appendChild(section);
    }

    addListSection('Improvement Tips', report?.improvement_tips);

    // Fallback — شكل غير متوقع تمامًا: نعرض الـ JSON الخام بدل ما نخفي البيانات
    if (!container.children.length) {
      container.textContent = JSON.stringify(report, null, 2);
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
    _uploadedItems = [];
    _postsRaw     = [];
    _skillsRaw    = [];

    // ── File UI
    // [MODIFIED] كان فيه pill واحد بيتشال يدويًا هنا — دلوقتي _renderItemChips()
    // بتتعامل مع كل حالات العرض (فاضي/فيه عناصر) في مكان واحد بس
    fileInput.value = '';
    _renderItemChips();

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
    ['block-bio','block-projects','block-linkedin-posts','block-report','block-skills']
      .forEach(id => {
        const el = $(id);
        if (el) el.style.display = 'none';
      });

    // ── Clear content
    ['content-bio','content-report'].forEach(id => {
      const el = $(id);
      if (el) { el.textContent = ''; el.removeAttribute('contenteditable'); }
    });
    const projectsContainer = $('projects-container');
    if (projectsContainer) projectsContainer.innerHTML = '';
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

      // [FIXED] لو حصل rate-limit جزئي جوه fetchGitHubData (بعد ما جاب
      // بروفايل وقايمة repos بنجاح، بس اتوقف قبل ما يخلّص كل الـ candidates)،
      // نوضّح للمستخدم إن النتيجة جزئية بدل ما نعرضها كأنها كاملة عادي.
      if (ghData.rate_limited) {
        window.toast('GitHub rate limit reached partway through — showing partial results. Try again in a few minutes for the rest.', 'warn');
      }

      // ── استخراج أفضل repos التي لديها README
      // البنية الصحيحة: ghData.top_repos (وليس ghData.repos)
      const reposWithReadme = (ghData.top_repos || [])
        .filter(r => r.readme && r.readme.trim().length > 0)
        .slice(0, 3);

      if (reposWithReadme.length === 0) {
        const msg = ghData.rate_limited
          ? 'GitHub rate limit reached before any README could be read. Try again in a few minutes.'
          : 'No READMEs found in your top repos. Please upload one manually.';
        window.toast(msg, 'warn');
        return;
      }

      // [MODIFIED] بدل ما نحطهم في state منفصل (window._autoReadmeItems)،
      // بندمجهم في نفس _uploadedItems اللي بيستخدمها الرفع اليدوي — عشان
      // كل مشروع (رفع يدوي أو GitHub) يبقى چيب مستقل قابل للحذف بمفرده
      // (راجع _renderItemChips/_removeItem) بدل pill واحد مُجمّع كان
      // بيتشال كله مع بعضه. بنحترم نفس حد MAX_UPLOAD_FILES الإجمالي،
      // وبنولّد اسم فريد لو فيه تعارض مع عنصر موجود بالفعل (زي repo
      // بنفس اسم ملف اتضاف يدويًا قبل كده).
      const remainingSlots = MAX_UPLOAD_FILES - _uploadedItems.length;
      if (remainingSlots <= 0) {
        window.toast(`You already have ${MAX_UPLOAD_FILES} projects loaded — remove one first to add GitHub repos.`, 'warn');
        return;
      }

      const toAdd = reposWithReadme.slice(0, remainingSlots);
      if (toAdd.length < reposWithReadme.length) {
        window.toast(`Only ${remainingSlots} more project(s) can be added (max ${MAX_UPLOAD_FILES} total).`, 'warn');
      }

      const existingNames = new Set(_uploadedItems.map(r => r.name));
      const newItems = toAdd.map(r => {
        const name = _makeUniqueName(r.name, existingNames);
        existingNames.add(name);
        return { name, content: r.readme, source: 'github' };
      });

      _uploadedItems = [..._uploadedItems, ...newItems];
      _renderItemChips();   // إعادة تقييم حالة الزر متضمّنة جوّاها

      if (hint) hint.textContent = `✓ Loaded ${newItems.length} README${newItems.length > 1 ? 's' : ''} — hit Analyze to generate!`;
      window.toast(`Loaded READMEs from ${newItems.length} repo${newItems.length > 1 ? 's' : ''}. Hit Analyze!`, 'success');

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
