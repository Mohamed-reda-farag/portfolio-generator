/**
 * auth.js — window.Auth
 * GitHub OAuth عبر Supabase
 * Dependencies: Supabase JS SDK (global), window.SUPABASE_URL, window.SUPABASE_ANON_KEY
 */

;(function () {
  'use strict';

  // ─── Supabase client (shared with ai.js لو موجود) ─────────────────────────
  let _supabase = null;

  function getClient() {
    if (_supabase) return _supabase;
    if (window._supabaseClient) {
      _supabase = window._supabaseClient;
      return _supabase;
    }
    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
      console.error('[Auth] SUPABASE_URL أو SUPABASE_ANON_KEY مش موجودين');
      return null;
    }
    _supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    window._supabaseClient = _supabase; // share مع ai.js
    return _supabase;
  }

  // ─── State ─────────────────────────────────────────────────────────────────
  let _currentUser = null;
  let _listeners   = [];

  // ─── Core Auth Functions ───────────────────────────────────────────────────

  /**
   * تسجيل دخول بـ GitHub OAuth
   * @param {string} [redirectTo] - URL بعد الـ login (default: dashboard.html)
   */
  async function signIn(redirectTo) {
    const client = getClient();
    if (!client) return { error: 'Supabase client غير مهيأ' };

    const destination = redirectTo || _buildDashboardURL();

    const { error } = await client.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: destination,
        scopes: 'read:user user:email public_repo',
      },
    });

    if (error) {
      console.error('[Auth] signIn error:', error.message);
      return { error: error.message };
    }

    return { error: null };
  }

  /**
   * تسجيل دخول بـ Google OAuth
   * @param {string} [redirectTo] - URL بعد الـ login (default: dashboard.html)
   */
  async function signInWithGoogle(redirectTo) {
    const client = getClient();
    if (!client) return { error: 'Supabase client غير مهيأ' };

    const destination = redirectTo || _buildDashboardURL();

    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: destination,
      },
    });

    if (error) {
      console.error('[Auth] signInWithGoogle error:', error.message);
      return { error: error.message };
    }

    return { error: null };
  }

  /**
   * تسجيل خروج
   */
  async function signOut() {
    const client = getClient();
    if (!client) return;

    const LOCAL_STORAGE_KEYS_TO_CLEAR = [
      'pg_builder_draft_v1',  // Portfolio Builder
      'pg_cv_data',           // CV Builder
    ];
    LOCAL_STORAGE_KEYS_TO_CLEAR.forEach(key => localStorage.removeItem(key));

    const { error } = await client.auth.signOut();
    if (error) console.error('[Auth] signOut error:', error.message);

    _currentUser = null;
    _notifyListeners(null);

    // Redirect للـ landing page
    window.location.href = _buildRelativeURL('index.html');
  }

  /**
   * جيب المستخدم الحالي (من الـ session أو null)
   * @returns {Promise<object|null>}
   */
  async function getUser() {
    if (_currentUser) return _currentUser;

    const client = getClient();
    if (!client) return null;

    const { data: { session }, error } = await client.auth.getSession();
    if (error || !session) return null;

    _currentUser = _buildUserObject(session.user);
    return _currentUser;
  }

  /**
   * Subscribe على تغيير الـ auth state
   * @param {function} callback - بيتنادى بـ (user | null)
   * @returns {function} unsubscribe
   */
  function onAuthStateChange(callback) {
    _listeners.push(callback);

    const client = getClient();
    if (!client) return () => {};

    const { data: { subscription } } = client.auth.onAuthStateChange(
      async (event, session) => {
        const user = session ? _buildUserObject(session.user) : null;
        _currentUser = user;
        _notifyListeners(user);

        // ── Ensure public.users row exists on EVERY sign-in ──────────────────
        // Bug 0 fix: _ensureUserRow must run for ALL providers on every SIGNED_IN
        // event — not only for new users. Without this, users who register without
        // triggering the DB trigger get 406 errors on all subsequent queries.
        if (event === 'SIGNED_IN' && session?.user) {
          const rawUser = session.user;

          // Always ensure the row exists (upsert is idempotent — safe to call repeatedly)
          await _ensureUserRow(rawUser);

          // Early Adopter grant — only on truly new accounts (created within last 5 min)
          const createdAt = new Date(rawUser.created_at).getTime();
          const isNewUser = (Date.now() - createdAt) < 300_000; // 5-minute window
          if (isNewUser) {
            // FIX 1: Wait 500ms for the DB write to propagate before reading the row
            await new Promise(r => setTimeout(r, 500));
            await _maybeGrantEarlyAdopter(rawUser.id);
          }
        }
      }
    );

    // Cleanup function
    return () => {
      _listeners = _listeners.filter(l => l !== callback);
      subscription?.unsubscribe();
    };
  }

  // ─── Auto-fill Form ────────────────────────────────────────────────────────

  /**
   * لو المستخدم logged in:
   * - بيخفي حقول الاسم والـ job title
   * - بيحط الـ github_username تلقائياً
   * - بيحدث الـ Nav
   */
  async function setupIndexPageAuth() {
    const user = await getUser();

    _updateNav(user);

    if (!user) return;

    // إخفاء الحقول اللي بتيجي من OAuth
    const nameField     = document.querySelector('[data-field="name"]');
    const jobField      = document.querySelector('[data-field="job-title"]');
    const nameWrapper   = nameField?.closest('.form-group') || nameField?.parentElement;
    const jobWrapper    = jobField?.closest('.form-group')  || jobField?.parentElement;

    if (nameWrapper) nameWrapper.style.display = 'none';
    if (jobWrapper)  jobWrapper.style.display  = 'none';

    // Auto-fill GitHub username
    const usernameInput = document.querySelector('[data-field="github-username"]');
    if (usernameInput && user.githubUsername) {
      usernameInput.value = user.githubUsername;
      usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // حفظ بيانات المستخدم في sessionStorage عشان الـ AI يستخدمها
    sessionStorage.setItem('auth_user', JSON.stringify({
      name:           user.name,
      jobTitle:       user.jobTitle,
      githubUsername: user.githubUsername,
    }));
  }

  /**
   * Redirect logic بعد الـ generation:
   * - logged in  → dashboard.html
   * - logged out → portfolio.html
   */
  function getPostGenerationRedirect() {
    return _currentUser
      ? _buildRelativeURL('dashboard.html')
      : _buildRelativeURL('portfolio.html');
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * يضمن وجود صف المستخدم في public.users بعد كل SIGNED_IN (GitHub أو Google)
   * — upsert بـ ON CONFLICT (id) DO UPDATE: يُنشئ الصف لو مش موجود، أو
   * يحدّث auth_provider/avatar_url/github_username لو موجود.
   * آمن تمامًا للاستدعاء المتكرر.
   *
   * ملاحظة: لا نحط referral_code هنا — موجود RPC منفصلة
   * (generate_user_referral_code) بتتولاه lazy عند فتح الـ Referral section.
   *
   * @param {object} rawUser - session.user من Supabase
   */
  async function _ensureUserRow(rawUser) {
    const client = getClient();
    if (!client) return;

    try {
      const provider = rawUser.app_metadata?.provider || 'github';
      const meta = rawUser.user_metadata || {};

      // Google users ملهومش GitHub username من الـ OAuth metadata
      const githubUsername = provider === 'github'
        ? (meta.user_name || meta.preferred_username || null)
        : null;

      const avatarUrl = meta.avatar_url || null;

      const { error } = await client
        .from('users')
        .upsert({
          id:              rawUser.id,
          email:           rawUser.email,
          github_username: githubUsername,
          full_name:       meta.full_name || meta.name || null,
          auth_provider:   provider,
          avatar_url:      avatarUrl,
        }, {
          onConflict: 'id',          // ON CONFLICT (id) DO UPDATE
          ignoreDuplicates: false,   // always update the existing row
        });

      if (error) {
        // Log clearly so it's easy to spot in the console
        console.error('[Auth] _ensureUserRow upsert FAILED:', {
          userId:   rawUser.id,
          provider,
          email:    rawUser.email,
          errorMsg: error.message,
          errorCode: error.code,
          details:  error.details,
        });
      } else {
        console.log('[Auth] _ensureUserRow: row ensured for', provider, 'user', rawUser.id);
      }
    } catch (err) {
      console.error('[Auth] _ensureUserRow exception:', {
        userId:  rawUser.id,
        message: err.message,
        err,
      });
    }
  }

  /**
   * منح Early Adopter Pro لأول 50 مستخدم جديد — يُستدعى مرة واحدة فقط عند أول تسجيل
   * @param {string} userId
   */
  async function _maybeGrantEarlyAdopter(userId) {
    const client = getClient();
    if (!client) return;

    try {
      // 1. اقرأ العداد الحالي
      const { data: counter, error: cErr } = await client
        .from('early_adopter_counter')
        .select('count, max_count')
        .eq('id', 1)
        .single();

      if (cErr || !counter) {
        console.warn('[Auth] Could not read early_adopter_counter:', cErr?.message);
        return;
      }

      // 2. تحقق من المقاعد المتاحة
      if (counter.count >= counter.max_count) return; // المقاعد انتهت

      // 3. FIX 2+3: قراءة صف المستخدم مع retry loop (يحمي من race condition بعد upsert)
      let existingUser = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data, error: rErr } = await client
          .from('users')
          .select('is_early_adopter')
          .eq('id', userId)
          .single();

        if (data) {
          existingUser = data;
          break;
        }
        // PGRST116 = no rows yet → retry; أي خطأ آخر → توقف
        if (rErr?.code !== 'PGRST116') {
          console.warn('[Auth] Unexpected error reading user row (attempt', attempt + 1, '):', rErr?.message);
          break;
        }
        if (attempt < 2) await new Promise(r => setTimeout(r, 800));
      }

      // FIX 3: لو الصف ما اتقرأش بعد كل المحاولات → تجاهل آمن (لا grant بدون تأكيد)
      if (!existingUser) {
        console.warn('[Auth] Could not read user row after retries — skipping Early Adopter grant for:', userId);
        return;
      }

      // بالفعل Early Adopter (لو منحناه في جلسة سابقة)
      if (existingUser.is_early_adopter) return;

      // 4. امنحه Pro لمدة 30 يوم
      const { error: uErr } = await client
        .from('users')
        .update({
          is_pro:                    true,
          is_early_adopter:          true,
          pro_plan:                  'early_adopter',
          early_adopter_expires_at:  new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq('id', userId);

      if (uErr) {
        console.error('[Auth] Failed to grant early adopter Pro:', uErr.message);
        return; // لا تزيد العداد لو فشل الـ grant
      }

      // 5. FIX 4: زيادة العداد بـ optimistic lock (يمنع التعارض عند تسجيل مستخدمَين في آن واحد)
      const { error: cUErr } = await client
        .from('early_adopter_counter')
        .update({ count: counter.count + 1 })
        .eq('id', 1)
        .eq('count', counter.count); // optimistic lock: يُنفَّذ فقط لو لم يتغير العداد

      if (cUErr) {
        console.warn('[Auth] Failed to increment early_adopter_counter (possible concurrency):', cUErr.message);
      }

      console.log('[Auth] 🎉 Early Adopter Pro granted to new user:', userId);

    } catch (err) {
      console.error('[Auth] _maybeGrantEarlyAdopter error:', err);
    }
  }

  function _buildUserObject(supabaseUser) {
    const meta = supabaseUser.user_metadata || {};
    return {
      id:             supabaseUser.id,
      email:          supabaseUser.email,
      name:           meta.full_name || meta.name || meta.user_name || '',
      githubUsername: meta.user_name  || meta.preferred_username || null,
      avatarUrl:      meta.avatar_url ||
        (meta.user_name ? `https://avatars.githubusercontent.com/${meta.user_name}` : null),
      jobTitle:       meta.job_title  || '', // لو حطّ المستخدم قبل كده في الـ DB
    };
  }

  function _notifyListeners(user) {
    _listeners.forEach(fn => {
      try { fn(user); } catch (e) { console.error('[Auth] listener error:', e); }
    });
  }

  function _buildDashboardURL() {
    // في Production: استخدم الـ origin كما هو بدون تعديل
    // في Development: نقبل localhost و127.0.0.1
    const origin = window.location.origin;
    const base   = origin + window.location.pathname;
    return base.replace(/\/[^/]*$/, '/dashboard.html');
  }

  function _buildRelativeURL(page) {
    const origin = window.location.origin;
    const base   = window.location.pathname.replace(/\/[^/]*$/, '/');
    return origin + base + page;
  }

  /** تحديث الـ Nav بناءً على الـ auth state */
  function _updateNav(user) {
    const signInBtn   = document.querySelector('[data-nav-signin]');
    const dashBtn     = document.querySelector('[data-nav-dashboard]');
    const avatarEl    = document.querySelector('[data-nav-avatar]');
    const signOutBtn  = document.querySelector('[data-nav-signout]');

    if (user) {
      signInBtn?.classList.add('hidden');
      dashBtn?.classList.remove('hidden');
      signOutBtn?.classList.remove('hidden');

      if (avatarEl) {
        avatarEl.src = user.avatarUrl;
        avatarEl.alt = user.name;
        avatarEl.classList.remove('hidden');
      }
    } else {
      signInBtn?.classList.remove('hidden');
      dashBtn?.classList.add('hidden');
      signOutBtn?.classList.add('hidden');
      avatarEl?.classList.add('hidden');
    }
  }

  // ─── Dashboard Page Init ───────────────────────────────────────────────────

  /**
   * يُستخدم في dashboard.html
   * بيجلب كل portfolios المستخدم من Supabase
   */
  // ─── Retry helper لـ public.users query (تحمي من 406 عند أول login) ──────
  async function _fetchUserRowWithRetry(client, userId, maxRetries = 3, delayMs = 1000) {
    for (let i = 0; i < maxRetries; i++) {
      const { data, error } = await client
        .from('users')
        .select('is_early_adopter, early_adopter_expires_at, is_pro, pro_expires_at')
        .eq('id', userId)
        .single();
      if (data) return { data, error: null };
      if (error?.code === 'PGRST116' || error?.code === '406') {
        if (i < maxRetries - 1) await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      return { data: null, error };
    }
    return { data: null, error: new Error('User row not found after retries') };
  }

  async function getDashboardData() {
    const client = getClient();
    if (!client) return { user: null, portfolios: [] };

    const user = await getUser();
    if (!user) return { user: null, portfolios: [] };

    // جيب بيانات المستخدم الإضافية من الـ DB (is_early_adopter، early_adopter_expires_at)
    const { data: dbUser } = await _fetchUserRowWithRetry(client, user.id);

    // ادمج بيانات Early Adopter على الـ user object
    if (dbUser) {
      user.isEarlyAdopter        = dbUser.is_early_adopter        || false;
      user.earlyAdopterExpiresAt = dbUser.early_adopter_expires_at || null;
      user.isPro                 = dbUser.is_pro                   || false;
      user.proExpiresAt          = dbUser.pro_expires_at           || null;
    }

    const { data: portfolios, error } = await client
      .from('portfolios')
      .select(`
        id,
        slug,
        theme,
        is_published,
        updated_at,
        bio,
        projects ( id, github_repo_name, stars, language )
      `)
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[Auth] getDashboardData error:', error.message);
      return { user, portfolios: [] };
    }

    return { user, portfolios: portfolios || [] };
  }

  /**
   * حذف portfolio بالكامل
   */
  async function deletePortfolio(portfolioId) {
    const client = getClient();
    if (!client) return { error: 'Client غير مهيأ' };

    const { error } = await client
      .from('portfolios')
      .delete()
      .eq('id', portfolioId);

    return { error: error?.message || null };
  }

  /**
   * Toggle published state
   */
  async function togglePublish(portfolioId, currentState) {
    const client = getClient();
    if (!client) return { error: 'Client غير مهيأ' };

    const { error } = await client
      .from('portfolios')
      .update({ is_published: !currentState })
      .eq('id', portfolioId);

    return { error: error?.message || null };
  }

  // ─── Auto-init ─────────────────────────────────────────────────────────────

  // بيتشغل تلقائياً على أي صفحة بيتحمل فيها auth.js
  document.addEventListener('DOMContentLoaded', async () => {
    const client = getClient();
    if (!client) return;

    // Initialize session
    const { data: { session } } = await client.auth.getSession();
    if (session) {
      _currentUser = _buildUserObject(session.user);
    }

    // الصفحة الرئيسية
    if (document.querySelector('[data-page="index"]')) {
      await setupIndexPageAuth();
    }

    // Dashboard — redirect لو مش logged in
    if (document.querySelector('[data-page="dashboard"]')) {
      if (!_currentUser) {
        window.location.href = _buildRelativeURL('index.html');
        return;
      }
      _updateNav(_currentUser);
    }
  });

  // ─── Public API ────────────────────────────────────────────────────────────
  window.Auth = {
    signIn,
    signInWithGoogle,
    signOut,
    getUser,
    onAuthStateChange,
    getDashboardData,
    deletePortfolio,
    togglePublish,
    getPostGenerationRedirect,
    setupIndexPageAuth,
  };

})();