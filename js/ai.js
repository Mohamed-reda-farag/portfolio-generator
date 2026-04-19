/**
 * js/ai.js — Portfolio Generator
 * ─────────────────────────────────────────────────────────────────────────────
 * Responsibilities:
 *  1. يستخدم window.GitHub (من github.js) لجلب البيانات
 *  2. يخزن generation record في Supabase DB
 *  3. يكلم Edge Function (generate) بالـ GitHub data
 *  4. يعرض progress real-time بـ Supabase Realtime
 *  5. يحفظ النتيجة في sessionStorage للـ Step 4 (portfolio.html)
 *  6. Error handling واضح للمستخدم مع toast notifications
 *
 * Dependencies (loaded before this file in HTML):
 *  - js/github.js          → window.GitHub
 *  - Supabase JS SDK       → window.supabase (from CDN)
 *
 * Script order in HTML:
 *  <script src="js/github.js"></script>
 *  <script src="js/ai.js"></script>   ← هنا
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function () {
  "use strict";

  // ─── Config ─────────────────────────────────────────────────────────────────

  const CONFIG = {
    SUPABASE_URL: window.SUPABASE_URL || "",        // من main.js / config
    SUPABASE_ANON_KEY: window.SUPABASE_ANON_KEY || "", // من main.js / config
    EDGE_FUNCTION_URL: "", // يُحسب تلقائياً من SUPABASE_URL
    SESSION_KEY: "pg_portfolio_draft",              // sessionStorage key
    GENERATION_TIMEOUT_MS: 45_000,                 // 45 ثانية max
    PROGRESS_STEPS: [
      { pct: 5,  label: "Fetching your GitHub profile…",       duration: 300 },
      { pct: 20, label: "Analyzing your repositories…",        duration: 800 },
      { pct: 40, label: "Understanding your tech stack…",      duration: 600 },
      { pct: 60, label: "Generating your bio with AI…",        duration: 1000 },
      { pct: 75, label: "Writing project descriptions…",       duration: 800 },
      { pct: 88, label: "Polishing your skills section…",      duration: 500 },
      { pct: 95, label: "Almost ready…",                       duration: 400 },
      { pct: 100, label: "Portfolio generated! 🎉",            duration: 200 },
    ],
  };

  // ─── State ──────────────────────────────────────────────────────────────────

  let _supabaseClient = null;
  let _realtimeChannel = null;
  let _progressInterval = null;
  let _currentStepIndex = 0;
  let _progressEl = null;
  let _progressLabelEl = null;
  let _isGenerating = false;

  // ─── Supabase client (lazy init) ────────────────────────────────────────────

  function getSupabaseClient() {
    if (_supabaseClient) return _supabaseClient;

    // استخدم الـ shared client من auth.js لو موجود (يمنع Multiple GoTrueClient)
    if (window._supabaseClient) {
      _supabaseClient = window._supabaseClient;
      CONFIG.EDGE_FUNCTION_URL = `${CONFIG.SUPABASE_URL}/functions/v1/generate`;
      return _supabaseClient;
    }

    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
      console.warn("[AI] Supabase not configured — running in offline mode.");
      return null;
    }

    // Supabase JS v2 — expected to be loaded from CDN
    if (!window.supabase?.createClient) {
      console.warn("[AI] Supabase SDK not loaded.");
      return null;
    }

    _supabaseClient = window.supabase.createClient(
      CONFIG.SUPABASE_URL,
      CONFIG.SUPABASE_ANON_KEY
    );

    // حساب Edge Function URL
    CONFIG.EDGE_FUNCTION_URL = `${CONFIG.SUPABASE_URL}/functions/v1/generate`;

    return _supabaseClient;
  }

  // ─── Progress Bar Helpers ────────────────────────────────────────────────────

  /**
   * يجد عناصر الـ progress في الـ DOM
   * بيدور على: [data-progress-bar] و [data-progress-label]
   */
  function findProgressElements() {
    _progressEl = document.querySelector("[data-progress-bar]");
    _progressLabelEl = document.querySelector("[data-progress-label]");
  }

  /**
   * يحدث الـ progress bar بـ animation ناعمة
   * @param {number} pct - 0 to 100
   * @param {string} label - النص اللي يظهر تحت الـ bar
   */
  function setProgress(pct, label) {
    if (_progressEl) {
      _progressEl.style.width = `${Math.min(100, Math.max(0, pct))}%`;
      _progressEl.setAttribute("aria-valuenow", pct);
    }
    if (_progressLabelEl && label) {
      _progressLabelEl.textContent = label;
    }
  }

  /**
   * يشغل الـ progress steps التلقائية (simulation)
   * بيتوقف لو وصل لـ 95% — الـ 5% الأخيرة للـ real completion
   */
  function startProgressSimulation() {
    _currentStepIndex = 0;
    clearInterval(_progressInterval);

    function advanceStep() {
      if (_currentStepIndex >= CONFIG.PROGRESS_STEPS.length) {
        clearInterval(_progressInterval);
        return;
      }

      const step = CONFIG.PROGRESS_STEPS[_currentStepIndex];
      setProgress(step.pct, step.label);
      _currentStepIndex++;

      // وقف عند 95% — استنى الـ real response
      if (step.pct >= 95) {
        clearInterval(_progressInterval);
        return;
      }

      clearInterval(_progressInterval);
      _progressInterval = setTimeout(advanceStep, step.duration);
    }

    advanceStep();
  }

  function stopProgressSimulation() {
    clearInterval(_progressInterval);
    _progressInterval = null;
  }

  function completeProgress() {
    stopProgressSimulation();
    const last = CONFIG.PROGRESS_STEPS[CONFIG.PROGRESS_STEPS.length - 1];
    setProgress(last.pct, last.label);
  }

  // ─── Supabase Realtime ───────────────────────────────────────────────────────

  /**
   * يشترك في تحديثات الـ generation من Supabase Realtime
   * @param {string} generationId - UUID
   */
  function subscribeToGenerationUpdates(generationId) {
    const sb = getSupabaseClient();
    if (!sb || !generationId) return;

    _realtimeChannel = sb
      .channel(`generation:${generationId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ai_generations",
          filter: `id=eq.${generationId}`,
        },
        (payload) => {
          const { status } = payload.new || {};
          console.log("[AI] Realtime update:", status);

          if (status === "processing") {
            setProgress(50, "AI is writing your portfolio…");
          } else if (status === "completed") {
            completeProgress();
          } else if (status === "failed") {
            stopProgressSimulation();
            setProgress(0, "Generation failed.");
          }
        }
      )
      .subscribe();
  }

  function unsubscribeRealtime() {
    if (_realtimeChannel) {
      const sb = getSupabaseClient();
      if (sb) sb.removeChannel(_realtimeChannel);
      _realtimeChannel = null;
    }
  }

  // ─── DB Helpers ──────────────────────────────────────────────────────────────

  /**
   * يخزن record في ai_generations قبل الـ generation
   * @returns {string|null} generationId
   */
  async function createGenerationRecord(userId, githubData) {
    const sb = getSupabaseClient();
    if (!sb) return null;

    // نولد الـ UUID في الـ client عشان نتجنب .select() اللي محتاج SELECT RLS permission
    const id = crypto.randomUUID();

    const { error } = await sb
      .from("ai_generations")
      .insert({
        id,
        user_id: userId || null,
        status: "pending",
        github_data: githubData,
      });

    if (error) {
      console.warn("[AI] Could not create generation record:", error.message);
      return null; // مش مشكلة حرجة — الـ generation تكمّل بدون tracking
    }

    return id;
  }

  // ─── Session Storage ──────────────────────────────────────────────────────────

  /**
   * يحفظ الـ portfolio draft في sessionStorage
   * @param {object} data - { bio, skills, projects, githubUser, jobTitle, theme }
   */
  function savePortfolioDraft(data) {
    try {
      sessionStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify({
        ...data,
        _savedAt: Date.now(),
        _version: "1.0",
      }));
    } catch (e) {
      console.warn("[AI] sessionStorage write failed:", e.message);
    }
  }

  /**
   * يقرأ الـ draft المحفوظ
   * @returns {object|null}
   */
  function getPortfolioDraft() {
    try {
      const raw = sessionStorage.getItem(CONFIG.SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Draft صالح لـ 2 ساعة
      if (Date.now() - parsed._savedAt > 2 * 60 * 60 * 1000) {
        sessionStorage.removeItem(CONFIG.SESSION_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function clearPortfolioDraft() {
    sessionStorage.removeItem(CONFIG.SESSION_KEY);
  }

  // ─── Error Messages ───────────────────────────────────────────────────────────

  const ERROR_MESSAGES = {
    RATE_LIMITED:
      "The AI is a bit busy right now. Please try again in 30 seconds.",
    AUTH_ERROR:
      "Server configuration issue. Please contact support.",
    PARSE_ERROR:
      "The AI response was unexpected. Please try again.",
    INVALID_STRUCTURE:
      "The AI returned an incomplete response. Please try again.",
    GROQ_ERROR:
      "The AI service is temporarily unavailable. Please try again.",
    NETWORK:
      "Network error — check your connection and try again.",
    TIMEOUT:
      "Generation timed out. GitHub or AI might be slow — please retry.",
    GITHUB_MISSING:
      "Could not find GitHub data. Please go back and fetch your GitHub profile first.",
    DEFAULT:
      "Something went wrong. Please try again.",
  };

  function getErrorMessage(code) {
    if (!code) return ERROR_MESSAGES.DEFAULT;
    const key = Object.keys(ERROR_MESSAGES).find((k) =>
      code.toUpperCase().includes(k)
    );
    return key ? ERROR_MESSAGES[key] : ERROR_MESSAGES.DEFAULT;
  }

  // ─── Toast (بيستخدم window.toast من app.js لو موجود) ──────────────────────

  function showToast(message, type = "error") {
    if (typeof window.toast === "function") {
      window.toast(message, type);
    } else {
      // fallback بسيط لو app.js مش محمّل
      console[type === "error" ? "error" : "log"](`[Toast] ${message}`);
      alert(message);
    }
  }

  // ─── Button State ─────────────────────────────────────────────────────────────

  function setButtonLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.classList.add("loading");
      btn.textContent = "Generating…";
    } else {
      btn.disabled = false;
      btn.classList.remove("loading");
      btn.textContent = btn.dataset.originalText || "Generate Portfolio";
    }
  }

  // ─── Core: Generate Portfolio ─────────────────────────────────────────────────

  /**
   * الدالة الرئيسية — تُستدعى من الـ form submit في index.html
   *
   * @param {object} options
   * @param {string} options.githubUsername  - من الـ form
   * @param {string} options.fullName        - من الـ form
   * @param {string} options.jobTitle        - من الـ form
   * @param {string} [options.theme]         - الـ theme المختارة (default: 'dark')
   * @param {HTMLElement} [options.submitBtn] - زر الـ submit للـ loading state
   * @param {string} [options.redirectUrl]   - الصفحة اللي يروح عليها بعد الـ generation
   * @returns {Promise<{success: boolean, data?: object, error?: string}>}
   */
  async function generatePortfolio({
    githubUsername,
    fullName,
    jobTitle = "Software Developer",
    theme = "dark",
    submitBtn = null,
    redirectUrl = "edit.html",
  } = {}) {
    if (_isGenerating) {
      console.warn("[AI] Generation already in progress.");
      return { success: false, error: "Already generating." };
    }

    if (!githubUsername) {
      showToast("Please enter a GitHub username.", "error");
      return { success: false, error: "Missing GitHub username." };
    }

    // ── تحقق من window.GitHub ──────────────────────────────────────────────
    if (!window.GitHub?.fetchGitHubData) {
      showToast(ERROR_MESSAGES.GITHUB_MISSING, "error");
      return { success: false, error: "GitHub module not loaded." };
    }

    _isGenerating = true;
    setButtonLoading(submitBtn, true);
    findProgressElements();

    // إظهار progress container لو مخفي
    const progressContainer = document.querySelector("[data-progress-container]");
    if (progressContainer) {
      progressContainer.style.display = "block";
      progressContainer.setAttribute("aria-hidden", "false");
    }

    startProgressSimulation();

    try {
      // ── Step 1: جلب GitHub data ────────────────────────────────────────────
      setProgress(5, "Fetching your GitHub profile…");

      let githubData;
      try {
        githubData = await Promise.race([
          window.GitHub.fetchGitHubData(githubUsername),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("TIMEOUT: GitHub fetch timed out.")), CONFIG.GENERATION_TIMEOUT_MS)
          ),
        ]);
      } catch (ghError) {
        const msg = ghError.message || "";
        if (msg.includes("NOT_FOUND")) {
          throw new Error("GitHub user not found. Please check the username.");
        }
        if (msg.includes("RATE_LIMITED")) {
          throw new Error("GitHub rate limit reached. Please try again in a few minutes.");
        }
        if (msg.includes("EMPTY_PROFILE")) {
          throw new Error("This GitHub account has no public repositories to analyze.");
        }
        throw ghError;
      }

      setProgress(35, "Analyzing your repositories…");
      await sleep(300);

      // ── Step 2: تخزين generation record في DB ──────────────────────────────
      const sb = getSupabaseClient();
      let generationId = null;

      if (sb) {
        const currentUser = (await sb.auth.getUser())?.data?.user;
        generationId = await createGenerationRecord(
          currentUser?.id || null,
          githubData
        );
        if (generationId) {
          subscribeToGenerationUpdates(generationId);
        }
      }

      setProgress(45, "Sending data to AI…");

      // ── Step 3: استدعاء Edge Function ──────────────────────────────────────
      const edgeUrl = CONFIG.EDGE_FUNCTION_URL ||
        `${CONFIG.SUPABASE_URL}/functions/v1/generate`;

      // Headers
      const headers = {
        "Content-Type": "application/json",
      };

      // أضف Authorization header لو في user مسجل دخول
      if (sb) {
        const { data: sessionData } = await sb.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (accessToken) {
          headers["Authorization"] = `Bearer ${accessToken}`;
        } else {
          // استخدم الـ anon key للمستخدمين غير المسجلين
          headers["Authorization"] = `Bearer ${CONFIG.SUPABASE_ANON_KEY}`;
        }
      }

      let response;
      try {
        response = await Promise.race([
          fetch(edgeUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({
              githubData: {
                user: {
                  ...githubData.user,
                  languages: Object.fromEntries(
                    githubData.languages.map(l => [l.language, l.bytes])
                  ),
                },
                repos: githubData.top_repos,
              },
              jobTitle,
              generationId,
            }),
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("TIMEOUT: AI generation timed out.")),
              CONFIG.GENERATION_TIMEOUT_MS
            )
          ),
        ]);
      } catch (fetchError) {
        if (fetchError.message?.includes("TIMEOUT")) throw fetchError;
        throw new Error("NETWORK: Could not reach the generation server.");
      }

      // ── Step 4: Parse response ─────────────────────────────────────────────
      setProgress(90, "Finalizing your portfolio…");

      let responseData;
      try {
        responseData = await response.json();
      } catch {
        throw new Error("PARSE_ERROR: Server returned invalid response.");
      }

      if (!response.ok || !responseData.success) {
        const errorCode = responseData?.code || `HTTP_${response.status}`;
        throw new Error(`${errorCode}: ${responseData?.error || "Generation failed."}`);
      }

      const aiData = responseData.data;

      // ── Step 5: حفظ في sessionStorage ──────────────────────────────────────
      const portfolioDraft = {
        bio: aiData.bio,
        skills: aiData.skills,
        projects: aiData.projects,
        githubUser: githubData.user,
        githubRepos: githubData.top_repos,
        fullName: fullName || githubData.user.name || githubUsername,
        jobTitle,
        theme,
        githubUsername,
        generationId,
      };

      savePortfolioDraft(portfolioDraft);

      // ── Step 6: إنهاء الـ progress ──────────────────────────────────────────
      completeProgress();
      await sleep(600); // اسمح للـ animation تكتمل

      unsubscribeRealtime();

      // ── Step 7: Redirect ────────────────────────────────────────────────────
      console.log("[AI] Generation complete! Redirecting to", redirectUrl);
      window.location.href = redirectUrl;

      return { success: true, data: portfolioDraft };

    } catch (error) {
      stopProgressSimulation();
      unsubscribeRealtime();

      const errorMsg = error.message || "";
      const errorCode = errorMsg.split(":")[0]?.trim();
      const userMessage = getErrorMessage(errorCode);

      console.error("[AI] Generation failed:", error);
      setProgress(0, "Generation failed. Please try again.");

      showToast(userMessage, "error");

      // إخفاء progress container عند الـ error
      const progressContainer = document.querySelector("[data-progress-container]");
      if (progressContainer) {
        setTimeout(() => {
          progressContainer.style.display = "none";
        }, 2000);
      }

      return { success: false, error: userMessage };

    } finally {
      _isGenerating = false;
      setButtonLoading(submitBtn, false);
    }
  }

  // ─── Helper: sleep ────────────────────────────────────────────────────────────

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ─── Auto-init: Form Listener ─────────────────────────────────────────────────

  /**
   * يتصل تلقائياً بـ form الـ generate في index.html
   * يدور على: [data-generate-form]
   */
  function initFormListener() {
    const form = document.querySelector("[data-generate-form]");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const githubUsername = (
        form.querySelector("[data-field='github-username']")?.value ||
        form.querySelector("#input-github")?.value ||
        ""
      ).trim();

      const fullName = (
        form.querySelector("[data-field='name']")?.value ||
        form.querySelector("#input-name")?.value ||
        ""
      ).trim();

      const jobTitle = (
        form.querySelector("[data-field='job-title']")?.value ||
        form.querySelector("#input-title")?.value ||
        ""
      ).trim();

      // الـ theme المختارة (من sessionStorage أو default)
      let theme = "dark";
      try {
        const savedTheme = sessionStorage.getItem("pg_theme") || sessionStorage.getItem("pg_selected_theme");
        if (savedTheme) theme = savedTheme;
      } catch {}

      const submitBtn = form.querySelector("[type='submit']");

      await generatePortfolio({
        githubUsername,
        fullName,
        jobTitle,
        theme,
        submitBtn,
        redirectUrl: "edit.html",
      });
    });

    console.log("[AI] Form listener attached.");
  }

  // ─── Auto-init on DOMContentLoaded ───────────────────────────────────────────

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFormListener);
  } else {
    initFormListener();
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  window.AI = {
    /**
     * الدالة الرئيسية — يمكن استدعاؤها من أي مكان
     */
    generate: generatePortfolio,

    /**
     * قراءة الـ draft المحفوظ في sessionStorage
     * تُستخدم في edit.html و portfolio.html
     */
    getDraft: getPortfolioDraft,

    /**
     * مسح الـ draft
     */
    clearDraft: clearPortfolioDraft,

    /**
     * حفظ الـ draft يدوياً (بعد inline editing مثلاً)
     */
    saveDraft: savePortfolioDraft,

    /**
     * Session storage key (للاستخدام الخارجي)
     */
    SESSION_KEY: CONFIG.SESSION_KEY,

    /**
     * هل في generation جارية الآن؟
     */
    get isGenerating() {
      return _isGenerating;
    },
  };

  console.log("[AI] ai.js loaded — window.AI ready.");
})();