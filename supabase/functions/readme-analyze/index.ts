// supabase/functions/readme-analyze/index.ts
// README Analyzer — Portfolio Generator
// Receives README content → builds prompt per output type → calls Groq → returns JSON

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

// [FIXED] إعادة تصميم — كان فيه حقل واحد readmeContent (نص مُدمج لكل الملفات/الـ
// repos)، فمكنش فيه أي طريقة يميّز الموديل بين المشاريع، وكان أي قص للنص
// (truncation) بيدمّر المشاريع اللي مش أول واحد. دلوقتي كل مشروع عنصر
// مستقل بالاسم، وده اللي بيسمح بوصف مستقل + بوست مستقل لكل مشروع مع الحفاظ
// على bio واحد شامل.
interface ReadmeItem {
  name:    string;   // اسم الملف أو الـ repo — بيُستخدم لتسمية الوصف/البوست الخاص به
  content: string;
}

interface ProjectDescription {
  name:        string;   // لازم يطابق أحد أسماء readmeItems المُرسلة
  description: string;
}

interface LinkedInPost {
  project:  string;   // اسم المشروع اللي البوست ده عنه — لازم يطابق أحد أسماء readmeItems
  post:     string;
  hashtags: string[];
}

interface LinkedInReport {
  profile_strength_score: number;
  key_strengths: string[];
  recommended_keywords: string[];
  industry_benchmark: string;
  improvement_tips: string[];
}

interface AnalyzeOutputs {
  bio?:            string;                 // بيو واحد شامل لكل المشاريع/المهارات مجتمعة
  projects?:       ProjectDescription[];   // [FIXED] كان project: string واحد — بقى وصف مستقل لكل مشروع
  linkedin_posts?: LinkedInPost[];         // [FIXED] بقى بوست واحد لكل مشروع (بدل 3 زوايا على مشروع واحد)
  report?:         LinkedInReport;         // تقرير شامل واحد
  skills?:         string[];               // قائمة مهارات مجمّعة واحدة
}

interface AnalyzeRequest {
  readmeItems?:     ReadmeItem[];   // الشكل الجديد — مصفوفة مشاريع مسمّاة
  readmeContent?:   string;         // [DEPRECATED] الشكل القديم — نص واحد مُدمج، نحافظ عليه لتوافق رجعي فقط
  requestedOutputs: string[];
  userId?:          string;
}

// ─── CORS (نفس نمط generate/index.ts) ────────────────────────────────────────

const ALLOWED_ORIGINS = [
  "https://portfolio-generator-taupe.vercel.app",
  "http://127.0.0.1:5500",   // [MODIFIED] Live Server — تطوير محلي فقط
];

function getCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin =
    requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)
      ? requestOrigin
      : ALLOWED_ORIGINS[0];

  return {
    "Access-Control-Allow-Origin":  origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// ─── Output prompt templates ───────────────────────────────────────────────────
//
// Design decision: نفصل الـ prompts في object عشان يكون سهل تعديل أي output
// بدون ما تمس الباقيين. كل key بيتوافق مع الـ requestedOutputs array.

const OUTPUT_PROMPTS: Record<string, string> = {
  bio: `Write ONE professional developer bio of 150-200 words that synthesizes ALL the projects
provided below — treat them as one developer's combined body of work.
Focus on the expertise implied by the tech stack, architecture decisions, and project goals across
all of them. Write in first person. Avoid generic filler words like "passionate", "love coding", "dedicated".
Lead with what the developer BUILDS, not who they are.
Return as a plain string under the key "bio".`,

  // [FIXED] كان "project" (وصف واحد لأول مشروع بس فعليًا). بقى "projects" —
  // وصف مستقل لكل مشروع تم توفيره، بالاسم بالضبط.
  projects: `For EACH project listed below (there are {{PROJECT_COUNT}} projects, named exactly:
{{PROJECT_NAMES}}), write an independent project description of 100-150 words suitable for a developer portfolio.
Sentence 1: What problem does this specific project solve and who benefits — be concrete.
Sentence 2: The technical approach — name the exact stack, architecture, or clever solutions visible in ITS OWN README.
Do not blend details from one project into another's description.
Return as a JSON array under the key "projects", where each item is exactly:
{ "name": "<one of the exact project names above>", "description": "..." }
The array MUST contain exactly {{PROJECT_COUNT}} items, one per project, using the exact names given.`,

  // [FIXED] كانت 3 بوستات بزوايا مختلفة على مشروع واحد مُدمج. بقت بوست واحد
  // مستقل لكل مشروع فعلي تم توفيره.
  linkedin_posts: `For EACH project listed below (there are {{PROJECT_COUNT}} projects, named exactly:
{{PROJECT_NAMES}}), write ONE independent LinkedIn post about THAT project specifically.
Each post should be 150-200 words, professional yet engaging tone, focused on the problem solved,
the technical approach, and its impact — and include relevant hashtags.
Return as a JSON array under the key "linkedin_posts", where each item is exactly:
{ "project": "<one of the exact project names above>", "post": "...", "hashtags": ["hashtag1", "hashtag2", ...] }
The array MUST contain exactly {{PROJECT_COUNT}} items, one per project, using the exact names given.`,

  // [MODIFIED] كان اسمها "LinkedIn Presence Report" — بيوحي إنها بتحلل
  // بروفايل LinkedIn موجود بالفعل، بينما هي فعليًا توصية مبنية على الـ
  // READMEs بس (مفيش أي وصول حقيقي لـ LinkedIn). "Optimization Report"
  // أدق لوظيفتها الحقيقية: تقييم + توصيات لتحسين البروفايل.
  report: `Generate ONE overall LinkedIn Optimization Report for a developer, based on ALL the projects
provided below combined — this is a holistic assessment of their whole portfolio, not per project.
Include:
  - profile_strength_score: integer 0-100
  - key_strengths: array of 3-4 strings describing what this body of work demonstrates
  - recommended_keywords: array of 8-12 LinkedIn keywords to optimize the profile
  - industry_benchmark: 1-2 sentences comparing this portfolio's scope to typical industry standards
  - improvement_tips: array of exactly 3 actionable tips to strengthen the LinkedIn profile
Return as a JSON object under the key "report".`,

  skills: `Extract ALL technologies, frameworks, languages, tools, platforms, and libraries
mentioned or clearly implied across ALL the projects provided below combined — one flat, de-duplicated list.
Include programming languages, frameworks, databases, cloud services, dev tools, testing libraries, etc.
Return as a flat JSON array of strings under the key "skills".
Example: ["React", "Node.js", "PostgreSQL", "Docker", "Jest"]`,
};

// ─── Build prompt ──────────────────────────────────────────────────────────────
//
// Design decision: نبني prompt واحد بدل multiple API calls عشان:
// 1. أسرع وأرخص من حيث الـ tokens
// 2. الـ model يشوف كل المشاريع مرة واحدة بس ويولّد كل الـ outputs معاً
//    (بيو شامل واحد + وصف/بوست مستقل لكل مشروع بالاسم)
// 3. أسهل في الـ error handling

// [FIXED] كان فيه قص ثابت على 15000 حرف لنص واحد مُدمج — لو المشروع الأول
// كان طويل، المشاريع الباقية تختفي بالكامل من غير أي تنبيه. دلوقتي كل
// مشروع بياخد حصة عادلة من ميزانية إجمالية قبل الدمج.
const TOTAL_CONTENT_BUDGET = 20000; // إجمالي الحروف المسموح بيها لكل المشاريع معاً
const MIN_PER_ITEM_BUDGET  = 2000;  // حد أدنى لكل مشروع حتى لو كان عددهم كبير

function buildPrompt(
  items: ReadmeItem[],
  requestedOutputs: string[]
): { system: string; user: string } {

  const system = `You are an expert technical writer, LinkedIn content strategist, and developer advocate.
You analyze README files from software projects and generate professional, high-quality content.
Your writing is specific, concrete, and avoids generic filler phrases.
You extract real details from READMEs — tech stack, architecture decisions, use cases, metrics.
When a task asks for output per-project, keep each project's content strictly separate — never blend
details from one project into another's description or post.

CRITICAL: Respond ONLY with a single valid JSON object. No markdown, no backticks, no preamble, no explanation.
The JSON object must contain only the keys that were requested.`;

  // ── حصة عادلة لكل مشروع (بدل قص ثابت على النص المُدمج كله)
  const perItemBudget = Math.max(MIN_PER_ITEM_BUDGET, Math.floor(TOTAL_CONTENT_BUDGET / Math.max(1, items.length)));

  const projectNames = items.map(i => i.name);
  const projectCount = items.length;

  // Build instructions section per requested output — نستبدل الـ placeholders
  // بأسماء وعدد المشاريع الفعليين لكل طلب
  const outputInstructions = requestedOutputs
    .filter(key => OUTPUT_PROMPTS[key])
    .map(key => {
      const filled = OUTPUT_PROMPTS[key]
        .replace(/\{\{PROJECT_COUNT\}\}/g, String(projectCount))
        .replace(/\{\{PROJECT_NAMES\}\}/g, projectNames.map(n => `"${n}"`).join(', '));
      return `### ${key.toUpperCase()}\n${filled}`;
    })
    .join('\n\n');

  const projectsBlock = items
    .map(item => `---BEGIN PROJECT: "${item.name}"---\n${item.content.slice(0, perItemBudget)}\n---END PROJECT: "${item.name}"---`)
    .join('\n\n');

  const user = `Here are ${projectCount} project README(s) to analyze:

${projectsBlock}

Generate the following outputs and return them as a single JSON object with ONLY these keys: ${requestedOutputs.join(', ')}

${outputInstructions}

Remember: respond with ONLY the JSON object, nothing else.`;

  return { system, user };
}

// ─── Call Groq API ─────────────────────────────────────────────────────────────
//
// Design decision: نستخدم llama-4-scout (نفس generate/index.ts) عشان:
// 1. Consistent behavior مع باقي الـ app
// 2. response_format: json_object بيضمن output نظيف بدون markdown wrapping
// 3. temperature 0.7 عشان الـ content writing يكون creative بس مش random

async function callGroqAPI(
  prompt: { system: string; user: string },
  apiKey: string
): Promise<{ outputs: AnalyzeOutputs; tokensUsed: number }> {

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model:           "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [
        { role: "system", content: prompt.system },
        { role: "user",   content: prompt.user   },
      ],
      temperature:     0.7,
      // [FIXED] كان 4000 — ثابت وكافي لمخرجات مشروع واحد بس. دلوقتي المخرجات
      // (وصف + بوست لكل مشروع) بتكبر مع عدد المشاريع (لحد 5)، فرفعناه.
      max_tokens:      6000,
      response_format: { type: "json_object" },
    }),
    // [FIXED] كان 35s — رفعناها بما إن المخرجات ممكن تكبر مع عدد المشاريع
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error("[readme-analyze] Groq error:", response.status, body);

    if (response.status === 429)
      throw new Error("RATE_LIMITED: Groq API rate limit reached. Please try again in a moment.");
    if (response.status === 401)
      throw new Error("AUTH_ERROR: Invalid Groq API key.");
    throw new Error(`GROQ_ERROR: ${response.status} — ${body.slice(0, 200)}`);
  }

  const data       = await response.json();
  const rawContent = data?.choices?.[0]?.message?.content;
  const tokensUsed = data?.usage?.total_tokens || 0;

  if (!rawContent) throw new Error("EMPTY_RESPONSE: Groq returned no content.");

  let outputs: AnalyzeOutputs;
  try {
    outputs = JSON.parse(rawContent);
  } catch {
    // Fallback: try to extract JSON block
    const match = rawContent.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("PARSE_ERROR: Could not parse AI response as JSON.");
    outputs = JSON.parse(match[0]);
  }

  return { outputs, tokensUsed };
}

// ─── Main handler ──────────────────────────────────────────────────────────────

// Fix 7: migrated from `serve` (std@0.168.0) to native Deno.serve
Deno.serve(async (req: Request) => {
  const requestOrigin = req.headers.get("origin");
  const corsHeaders   = getCorsHeaders(requestOrigin);

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Env vars
  const groqApiKey        = Deno.env.get("GROQ_API_KEY")            || "";
  const supabaseUrl       = Deno.env.get("SUPABASE_URL")            || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!groqApiKey) {
    return new Response(
      JSON.stringify({ error: "Server configuration error: missing GROQ_API_KEY" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Parse body
  let body: AnalyzeRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON in request body." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Validate inputs
  // [FIXED] بقت readmeItems (مصفوفة مشاريع مسمّاة) هي الشكل الأساسي.
  // نحافظ على readmeContent (نص واحد) كـ fallback توافق رجعي فقط — لو
  // القديم هو المُرسل، نغلّفه كعنصر واحد اسمه "README" بدل ما نكسر أي
  // caller قديم.
  const { readmeItems, readmeContent, requestedOutputs, userId } = body;

  let items: ReadmeItem[];
  if (Array.isArray(readmeItems) && readmeItems.length > 0) {
    items = readmeItems.filter(it => it && typeof it.content === 'string' && it.content.trim());
  } else if (readmeContent?.trim()) {
    items = [{ name: 'README', content: readmeContent }];
  } else {
    items = [];
  }

  if (items.length === 0) {
    return new Response(
      JSON.stringify({ error: "readmeItems is required and must contain at least one non-empty project." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!Array.isArray(requestedOutputs) || requestedOutputs.length === 0) {
    return new Response(
      JSON.stringify({ error: "requestedOutputs must be a non-empty array." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Filter to only valid keys — بنتجاهل أي key غريب يبعته الـ client
  const validKeys    = Object.keys(OUTPUT_PROMPTS);
  const filteredKeys = requestedOutputs.filter(k => validKeys.includes(k));

  if (filteredKeys.length === 0) {
    return new Response(
      JSON.stringify({ error: `No valid output keys. Valid options: ${validKeys.join(", ")}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Server-side usage check (second layer of defence)
  //    الـ client بيعمل limit check، بس نعمله هنا كمان عشان مايتجاوزوهوش بـ direct API calls
  if (userId && supabaseUrl && supabaseServiceKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      const { data: userData } = await supabase
        .from("users")
        .select("is_pro, readme_analyses_used")
        .eq("id", userId)
        .single();

      if (userData) {
        const isPro = userData.is_pro === true;
        const used  = userData.readme_analyses_used || 0;

        if (!isPro && used >= 3) {
          return new Response(
            JSON.stringify({
              error:   "RATE_LIMITED: You've used all 3 free analyses. Upgrade to Pro for unlimited access.",
              code:    "RATE_LIMITED",
            }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    } catch (e) {
      // لو فشل الـ check ما نوقفش الـ request — نكمّل (degraded mode)
      console.warn("[readme-analyze] Server-side usage check failed:", e);
    }
  }

  // ── Build & call
  try {
    console.log(`[readme-analyze] Processing ${filteredKeys.join(", ")} for ${items.length} project(s), user: ${userId || "anon"}`);

    const prompt = buildPrompt(items, filteredKeys);
    const { outputs, tokensUsed } = await callGroqAPI(prompt, groqApiKey);

    console.log(`[readme-analyze] Success — ${tokensUsed} tokens, outputs: ${Object.keys(outputs).join(", ")}`);

    return new Response(
      JSON.stringify({ outputs, tokensUsed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[readme-analyze] Error:", message);

    let statusCode = 500;
    if (message.startsWith("RATE_LIMITED")) statusCode = 429;
    if (message.startsWith("AUTH_ERROR"))   statusCode = 401;
    if (message.startsWith("PARSE_ERROR") || message.startsWith("EMPTY_RESPONSE")) statusCode = 422;

    return new Response(
      JSON.stringify({
        error: message,
        code:  message.split(":")[0],
      }),
      { status: statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
