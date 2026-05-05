// supabase/functions/linkedin-generate/index.ts
// Portfolio Generator — LinkedIn Presence Generator
// Receives GitHub data + language → calls Groq → returns LinkedIn content

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RepoData {
  name: string;
  description: string | null;
  html_url: string;
  stars: number;
  language: string | null;
  topics: string[];
  readme: string | null;
  priority_score: number;
  pushed_at: string;
  fork: boolean;
  archived: boolean;
}

interface GitHubUser {
  login: string;
  name: string | null;
  bio: string | null;
  followers: number;
  following: number;
  public_repos: number;
  company: string | null;
  location: string | null;
  blog: string | null;
  created_at: string;
}

interface LinkedInRequest {
  githubData: {
    user: GitHubUser;
    top_repos: RepoData[];
    all_repos: RepoData[];
    languages: { language: string; bytes: number; percentage: number }[];
    total_stars: number;
    total_repos: number;
  };
  lang: "ar" | "en";
  generationId?: string;
}

interface ScoreBreakdown {
  readme_quality: number;
  commit_frequency: number;
  repo_descriptions: number;
  project_diversity: number;
  profile_completeness: number;
}

interface ProjectPost {
  repo_name: string;
  post_content: string;
}

interface LinkedInResponse {
  score: number;
  score_breakdown: ScoreBreakdown;
  weak_points: string[];
  headline: string;
  about: string;
  posts: ProjectPost[];
}

// ─── CORS Headers ─────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  "https://portfolio-generator-taupe.vercel.app",
];

function getCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin =
    requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)
      ? requestOrigin
      : ALLOWED_ORIGINS[0];

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// ─── Helper: Update generation status ─────────────────────────────────────────

async function updateGenerationStatus(
  supabase: ReturnType<typeof createClient>,
  generationId: string,
  status: "pending" | "processing" | "completed" | "failed",
  extra: Record<string, unknown> = {}
) {
  if (!generationId) return;
  await supabase
    .from("ai_generations")
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq("id", generationId);
}

// ─── Score Calculation (deterministic — not AI) ───────────────────────────────

function calculateScore(data: LinkedInRequest["githubData"]): {
  score: number;
  breakdown: ScoreBreakdown;
} {
  const { user, top_repos, languages } = data;

  // ── readme_quality (0-20) ──
  const reposWithReadme = top_repos.filter((r) => r.readme && r.readme.length > 100);
  const reposWithLongReadme = top_repos.filter((r) => r.readme && r.readme.length > 500);
  const readme_quality = Math.round(
    Math.min(20, (reposWithReadme.length / Math.max(top_repos.length, 1)) * 12 +
      (reposWithLongReadme.length / Math.max(top_repos.length, 1)) * 8)
  );

  // ── commit_frequency (0-20) ──
  const ninetyDaysAgo = Date.now() - 90 * 24 * 3600 * 1000;
  const thirtyDaysAgo = Date.now() - 30 * 24 * 3600 * 1000;
  const activeIn90 = top_repos.filter(
    (r) => r.pushed_at && new Date(r.pushed_at).getTime() > ninetyDaysAgo
  ).length;
  const activeIn30 = top_repos.filter(
    (r) => r.pushed_at && new Date(r.pushed_at).getTime() > thirtyDaysAgo
  ).length;
  const commit_frequency = Math.round(Math.min(20, activeIn30 * 5 + activeIn90 * 2));

  // ── repo_descriptions (0-20) ──
  const reposWithDesc = top_repos.filter(
    (r) => r.description && r.description.trim().length > 10
  );
  const repo_descriptions = Math.round(
    Math.min(20, (reposWithDesc.length / Math.max(top_repos.length, 1)) * 20)
  );

  // ── project_diversity (0-20) ──
  const uniqueLangs = (languages || []).length;
  const uniqueTopics = new Set(top_repos.flatMap((r) => r.topics || [])).size;
  const project_diversity = Math.round(Math.min(20, uniqueLangs * 2.5 + uniqueTopics * 0.5));

  // ── profile_completeness (0-20) ──
  const fields = [user.bio, user.location, user.company, user.blog];
  const filledFields = fields.filter(Boolean).length;
  const hasAvatar = true; // GitHub OAuth يضمن وجود الـ avatar
  const profile_completeness = Math.round(
    filledFields * 4 + (hasAvatar ? 4 : 0)
  );

  const score = Math.min(
    100,
    readme_quality + commit_frequency + repo_descriptions +
    project_diversity + profile_completeness
  );

  return {
    score,
    breakdown: {
      readme_quality,
      commit_frequency,
      repo_descriptions,
      project_diversity,
      profile_completeness,
    },
  };
}

// ─── Helper: Build Prompt ──────────────────────────────────────────────────────

function buildPrompt(
  req: LinkedInRequest,
  scoreData: { score: number; breakdown: ScoreBreakdown }
): { system: string; user: string } {
  const { user, top_repos, languages, total_stars, total_repos } = req.githubData;
  const lang = req.lang || "en";
  const isArabic = lang === "ar";
  const fullName = user.name || user.login;

  const topLangs = (languages || []).slice(0, 8).map((l) => l.language);

  const accountAge = user.created_at
    ? Math.floor(
        (Date.now() - new Date(user.created_at).getTime()) /
          (365.25 * 24 * 3600 * 1000)
      )
    : 1;

  // Rich repo summaries
  const repoSummaries = (top_repos || []).slice(0, 6).map((r) => ({
    name: r.name,
    description: r.description || "",
    language: r.language || "",
    stars: r.stars || 0,
    topics: (r.topics || []).slice(0, 6),
    readme_snippet: r.readme
      ? r.readme
          .slice(0, 1000)
          .replace(/#{1,6}\s/g, "")
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
          .replace(/\n+/g, " ")
          .trim()
      : "",
    url: r.html_url || `https://github.com/${user.login}/${r.name}`,
  }));

  // viral tag — always English for brand consistency
  const viralTag = `\n\n🔗 Generated by DevPresence · portfolio-generator-taupe.vercel.app/linkedin.html`;

  // ── System Prompts ──
  const systemAr = `أنت خبير في بناء الحضور المهني على LinkedIn للمطورين وكتابة المحتوى الذي يحقق انتشاراً واسعاً.
تعرف بالضبط ما الذي يجعل منشور LinkedIn يحصل على آلاف التفاعلات: hook قوي، قصة حقيقية، قيمة واضحة، CTA جذاب.
مهمتك: إنشاء محتوى LinkedIn يجعل المطور يبرز فعلاً — بناءً على بيانات GitHub الحقيقية.
اكتب بالعربية الفصحى السلسة، مع الحفاظ على المصطلحات التقنية بالإنجليزية.
الـ weak_points يجب أن تكون 3 خطوات محددة وقابلة للتنفيذ في أقل من أسبوع.
IMPORTANT: أجب دائماً بـ JSON صالح فقط — بدون markdown أو backticks أو مقدمة.`;

  const systemEn = `You are a top LinkedIn content strategist and personal brand expert for software developers.
You know exactly what makes a LinkedIn post go viral: a scroll-stopping hook, a relatable story, concrete value, and a strong CTA.
Your job: create LinkedIn content that makes this developer genuinely stand out — based on their real GitHub data.
Weak points must be exactly 3 specific, actionable steps completable in under a week.
IMPORTANT: Always respond with valid JSON only — no markdown, no backticks, no preamble.`;

  // ── Arabic User Prompt ──
  const promptAr = `بناءً على بيانات GitHub التالية، أنشئ محتوى LinkedIn احترافياً يحقق انتشاراً حقيقياً:

المطور: ${fullName}
GitHub: ${user.login}
المتابعون: ${user.followers}
المستودعات العامة: ${total_repos}
إجمالي النجوم: ${total_stars}
سنوات على GitHub: ${accountAge}+
اللغات الأساسية: ${topLangs.join(", ")}
النبذة على GitHub: ${user.bio || "غير محددة"}
الموقع: ${user.location || "غير محدد"}
الشركة: ${user.company || "غير محددة"}

الـ Score المحسوب مسبقاً (لا تغيره):
- الإجمالي: ${scoreData.score}/100
- readme_quality: ${scoreData.breakdown.readme_quality}/20
- commit_frequency: ${scoreData.breakdown.commit_frequency}/20
- repo_descriptions: ${scoreData.breakdown.repo_descriptions}/20
- project_diversity: ${scoreData.breakdown.project_diversity}/20
- profile_completeness: ${scoreData.breakdown.profile_completeness}/20

أهم المستودعات (اقرأ readme_snippet بعناية قبل كتابة كل منشور):
${JSON.stringify(repoSummaries, null, 2)}

أنشئ هذا الـ JSON فقط:
{
  "weak_points": [
    "<خطوة 1 محددة وقابلة للتنفيذ — مثال: أضف وصفاً لمستودع X يشرح المشكلة التي يحلها في جملتين>",
    "<خطوة 2 — محددة بنفس الأسلوب>",
    "<خطوة 3 — محددة بنفس الأسلوب>"
  ],
  "headline": "<عنوان LinkedIn — 220 حرف كحد أقصى — يجمع الدور + التقنية + القيمة — لا تستخدم passionate أو love coding>",
  "about": "<قسم About كامل — 4-5 فقرات — يبدأ بـ hook مميز (إحصائية أو سؤال) ثم الخبرة والمشاريع والمهارات وكيفية التواصل — لا تبدأ بالاسم أو بـ أنا>",
  "posts": [
    {
      "repo_name": "<اسم المستودع من القائمة بالضبط>",
      "post_content": "<منشور LinkedIn فيروسي — بنية: Hook صادم ← مشكلة ← رحلة البناء ← تقنيات مستخرجة من readme ← نتيجة أو درس ← CTA — أسطر فردية وemojis باعتدال${viralTag}"
    }
  ]
}

قواعد صارمة:
- weak_points: 3 فقط، محددة جداً — "أضف README لمشروع X" وليس "حسّن التوثيق"
- headline: لا تستخدم "passionate" أو "love coding" أو "enthusiastic" — ممنوعة
- posts: منشور واحد لكل مستودع في نفس الترتيب — استخرج تفاصيل حقيقية من readme_snippet
- كل منشور يجب أن يبدأ بـ hook مختلف تماماً عن الآخرين
- about: لا تبدأ بـ "أنا" أو اسم المطور`;

  // ── English User Prompt ──
  const promptEn = `Based on the following GitHub data, generate LinkedIn content that gets real engagement:

Developer: ${fullName}
GitHub: ${user.login}
Followers: ${user.followers}
Public Repos: ${total_repos}
Total Stars: ${total_stars}
Years on GitHub: ${accountAge}+
Primary Languages: ${topLangs.join(", ")}
GitHub Bio: ${user.bio || "Not provided"}
Location: ${user.location || "Not provided"}
Company: ${user.company || "Not provided"}

Pre-calculated Score (do NOT change these values):
- Total: ${scoreData.score}/100
- readme_quality: ${scoreData.breakdown.readme_quality}/20
- commit_frequency: ${scoreData.breakdown.commit_frequency}/20
- repo_descriptions: ${scoreData.breakdown.repo_descriptions}/20
- project_diversity: ${scoreData.breakdown.project_diversity}/20
- profile_completeness: ${scoreData.breakdown.profile_completeness}/20

Top Repositories (read readme_snippet carefully before writing each post):
${JSON.stringify(repoSummaries, null, 2)}

Generate ONLY this JSON:
{
  "weak_points": [
    "<specific actionable step 1 — e.g. 'Add a README to repo X that explains the problem it solves in 2 sentences'>",
    "<specific actionable step 2 — same level of specificity>",
    "<specific actionable step 3 — same level of specificity>"
  ],
  "headline": "<LinkedIn headline — max 220 chars — combine role + tech + value — no 'passionate', 'love coding', 'enthusiastic'>",
  "about": "<Full About section — 4-5 paragraphs — start with a scroll-stopping hook (a stat or a bold claim) then expertise, key projects with real details, skills, and how to reach them — never start with the developer's name or 'I am'>",
  "posts": [
    {
      "repo_name": "<exact repo name from the list>",
      "post_content": "<Viral LinkedIn post — structure: Shocking/curious Hook ← Problem ← Building journey ← Specific tech from readme ← Result/Lesson ← CTA — single-line breaks, emojis sparingly${viralTag}"
    }
  ]
}

Strict rules:
- weak_points: exactly 3, highly specific — 'Add description to repo X' not 'improve documentation'
- headline: 'passionate', 'love coding', 'enthusiastic', 'dedicated' are BANNED
- posts: one per repo in order — mine readme_snippet for real technical details
- every post must start with a completely different hook type
- about: never start with "I am" or the developer's name`;

  return {
    system: isArabic ? systemAr : systemEn,
    user: isArabic ? promptAr : promptEn,
  };
}

// ─── Helper: Call Groq API ─────────────────────────────────────────────────────

async function callGroqAPI(
  prompt: { system: string; user: string },
  apiKey: string,
  scoreData: { score: number; breakdown: ScoreBreakdown }
): Promise<LinkedInResponse & { _tokensUsed: number }> {
  const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
  const MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      max_tokens: 4000,
      temperature: 0.68,
      top_p: 0.9,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[linkedin-generate] Groq error:", response.status, errorBody);
    if (response.status === 429)
      throw new Error("RATE_LIMITED: Groq API rate limit reached. Please try again in a moment.");
    if (response.status === 401)
      throw new Error("AUTH_ERROR: Invalid Groq API key.");
    throw new Error(`GROQ_ERROR: ${response.status} — ${errorBody.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("EMPTY_RESPONSE: Groq returned no content.");

  const tokensUsed = data?.usage?.total_tokens || 0;

  let parsed: Omit<LinkedInResponse, "score" | "score_breakdown">;
  try {
    parsed = JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("PARSE_ERROR: Could not parse AI response as JSON.");
    parsed = JSON.parse(jsonMatch[0]);
  }

  if (
    !Array.isArray(parsed.weak_points) ||
    !parsed.headline ||
    !parsed.about ||
    !Array.isArray(parsed.posts)
  ) {
    throw new Error("INVALID_STRUCTURE: AI response missing required fields.");
  }

  return {
    // Score من الحسبة الحقيقية — مش من الـ AI
    score: scoreData.score,
    score_breakdown: scoreData.breakdown,
    weak_points: parsed.weak_points.slice(0, 3).map((w: unknown) => String(w).trim()).filter(Boolean),
    headline: String(parsed.headline).trim().slice(0, 220),
    about: String(parsed.about).trim(),
    posts: parsed.posts.map((p: { repo_name?: unknown; post_content?: unknown }) => ({
      repo_name: String(p.repo_name || "").trim(),
      post_content: String(p.post_content || "").trim(),
    })),
    _tokensUsed: tokensUsed,
  };
}

// ─── Main Handler ──────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  const requestOrigin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(requestOrigin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const groqApiKey = Deno.env.get("GROQ_API_KEY") || "";

  if (!groqApiKey) {
    return new Response(JSON.stringify({ error: "Server configuration error." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  let generationId = "";

  try {
    let body: LinkedInRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON in request body." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!body.githubData?.user || !body.githubData?.top_repos) {
      return new Response(
        JSON.stringify({ error: "Missing githubData.user or githubData.top_repos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const lang = body.lang === "ar" ? "ar" : "en";
    generationId = body.generationId || "";

    // Rate limiting
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (token && token !== (Deno.env.get("SUPABASE_ANON_KEY") || "")) {
      try {
        const { data: userPayload } = await supabase.auth.getUser(token);
        const userId = userPayload?.user?.id;
        if (userId) {
          const since24h = new Date(Date.now() - 86_400_000).toISOString();
          const { count } = await supabase
            .from("ai_generations")
            .select("*", { count: "exact", head: true })
            .eq("user_id", userId)
            .gte("created_at", since24h);

          if ((count ?? 0) >= 5) {
            return new Response(
              JSON.stringify({
                success: false,
                error: "RATE_LIMITED: You've reached the daily limit (5 generations/day). Please try again tomorrow.",
                code: "RATE_LIMITED",
              }),
              { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
      } catch (rateLimitErr) {
        console.warn("[linkedin-generate] Rate limit check failed:", rateLimitErr);
      }
    }

    await updateGenerationStatus(supabase, generationId, "processing", {
      github_data: body.githubData,
      function_type: "linkedin",
    });

    console.log(`[linkedin-generate] Starting for: ${body.githubData.user.login} | lang: ${lang}`);

    // ── حساب الـ Score في الكود — مش بالـ AI ──
    const scoreData = calculateScore(body.githubData);
    console.log(`[linkedin-generate] Score calculated: ${scoreData.score}/100`);

    const prompt = buildPrompt({ ...body, lang }, scoreData);
    const result = await callGroqAPI(prompt, groqApiKey, scoreData);

    const tokensUsed = result._tokensUsed;
    // @ts-ignore
    delete result._tokensUsed;

    console.log(`[linkedin-generate] Done for ${body.githubData.user.login} — ${tokensUsed} tokens`);

    await updateGenerationStatus(supabase, generationId, "completed", {
      tokens_used: tokensUsed,
      function_type: "linkedin",
    });

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[linkedin-generate] Error:", errorMessage);

    await updateGenerationStatus(supabase, generationId, "failed", {
      error_message: errorMessage.slice(0, 500),
      function_type: "linkedin",
    });

    let statusCode = 500;
    if (errorMessage.startsWith("RATE_LIMITED")) statusCode = 429;
    if (errorMessage.startsWith("AUTH_ERROR")) statusCode = 401;
    if (errorMessage.startsWith("PARSE_ERROR") || errorMessage.startsWith("INVALID_STRUCTURE"))
      statusCode = 422;

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        code: errorMessage.split(":")[0],
      }),
      { status: statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
