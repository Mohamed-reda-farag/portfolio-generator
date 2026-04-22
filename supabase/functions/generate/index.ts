// supabase/functions/generate/index.ts
// Portfolio Generator — AI Generation Edge Function
// Receives GitHub data → builds prompt → calls Groq API → returns JSON

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RepoData {
  name: string;
  description: string | null;
  url: string;
  stars: number;
  language: string | null;
  topics: string[];
  readme: string | null;
  priorityScore: number;
}

interface GitHubUser {
  login: string;
  name: string | null;
  bio: string | null;
  followers: number;
  public_repos: number;
  languages: Record<string, number>;
}

interface GenerateRequest {
  githubData: {
    user: GitHubUser;
    repos: RepoData[];
  };
  jobTitle?: string;
  generationId?: string; // لتتبع الـ progress في Supabase Realtime
}

interface GenerateResponse {
  bio: string;
  skills: string[];
  projects: {
    repo_name: string;
    description: string;
  }[];
}

// ─── CORS Headers ────────────────────────────────────────────────────────────

// ⚠️ قيّد الـ CORS بـ domain بتاعك فقط — لا تستخدم "*" في Production
const ALLOWED_ORIGINS = [
  "https://portfolio-generator-taupe.vercel.app",
  // أضف هنا أي domain إضافي لو محتاج (staging مثلاً)
];

function getCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin =
    requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)
      ? requestOrigin
      : ALLOWED_ORIGINS[0]; // fallback للـ production domain

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// ─── Helper: Update generation status in DB ──────────────────────────────────

async function updateGenerationStatus(
  supabase: ReturnType<typeof createClient>,
  generationId: string,
  status: "pending" | "processing" | "completed" | "failed",
  extra: Record<string, unknown> = {}
) {
  if (!generationId) return;
  await supabase
    .from("ai_generations")
    .update({ status, ...extra })
    .eq("id", generationId);
}

// ─── Helper: Build the Groq prompt ───────────────────────────────────────────

function buildPrompt(req: GenerateRequest): { system: string; user: string } {
  const { user, repos } = req.githubData;
  const jobTitle = req.jobTitle || "Software Developer";
  const fullName = user.name || user.login;

  // Top languages sorted by usage
  const topLanguages = Object.entries(user.languages || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([lang]) => lang);

  // Prepare repos summary — concise for token efficiency
  const reposSummary = repos.slice(0, 6).map((r) => ({
    name: r.name,
    description: r.description || "",
    language: r.language || "",
    stars: r.stars,
    topics: (r.topics || []).slice(0, 5),
    readme_snippet: r.readme
      ? r.readme.slice(0, 300).replace(/\n+/g, " ").trim()
      : "",
  }));

  const system = `You are an expert technical writer and developer advocate.
Your job is to create compelling, authentic portfolio content for software developers.
Be concise, professional, and impressive. Focus on impact and technical depth.
Write in first person for the bio. Highlight real skills from the actual repos.
IMPORTANT: Always respond with valid JSON only — no markdown, no backticks, no preamble.`;

  const user_prompt = `Given this GitHub profile data, generate portfolio content:

Developer: ${fullName}
Job Title: ${jobTitle}
GitHub Username: ${user.login}
Followers: ${user.followers}
Public Repos: ${user.public_repos}
Primary Languages: ${topLanguages.join(", ")}
GitHub Bio: ${user.bio || "Not provided"}

Top Repositories (sorted by relevance):
${JSON.stringify(reposSummary, null, 2)}

Generate ONLY this JSON structure (no extra text):
{
  "bio": "2-3 sentences professional bio in first person. Highlight main expertise, favorite technologies, and what makes this developer unique. Be specific to their actual repos, not generic.",
  "skills": ["skill1", "skill2", ...],
  "projects": [
    {
      "repo_name": "exact repo name from the list above",
      "description": "2 impactful sentences: what it solves + key technologies used + any notable metrics (stars, scale, etc)"
    }
  ]
}

Rules:
- skills: max 12, extract from actual repos and languages, include frameworks/tools visible in repos
- projects: include all ${repos.slice(0, 6).length} repos provided, in the same order
- bio: specific and authentic — avoid clichés like "passionate developer" or "love coding"
- Keep descriptions technical but accessible`;

  return { system, user: user_prompt };
}

// ─── Helper: Call Groq API ────────────────────────────────────────────────────

async function callGroqAPI(
  prompt: { system: string; user: string },
  apiKey: string
): Promise<GenerateResponse> {
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
      max_tokens: 2000,
      temperature: 0.7,
      top_p: 0.9,
      // Force JSON output
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(30_000), // 30s timeout
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Groq API error:", response.status, errorBody);

    if (response.status === 429) {
      throw new Error("RATE_LIMITED: Groq API rate limit reached. Please try again in a moment.");
    }
    if (response.status === 401) {
      throw new Error("AUTH_ERROR: Invalid Groq API key.");
    }
    throw new Error(`GROQ_ERROR: ${response.status} — ${errorBody.slice(0, 200)}`);
  }

  const data = await response.json();

  // Extract content from Groq response
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("EMPTY_RESPONSE: Groq returned no content.");
  }

  const tokensUsed = data?.usage?.total_tokens || 0;

  // Parse JSON — Groq with response_format should return clean JSON
  let parsed: GenerateResponse;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Fallback: try to extract JSON from the content
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("PARSE_ERROR: Could not parse AI response as JSON.");
    }
    parsed = JSON.parse(jsonMatch[0]);
  }

  // Validate structure
  if (!parsed.bio || !Array.isArray(parsed.skills) || !Array.isArray(parsed.projects)) {
    throw new Error("INVALID_STRUCTURE: AI response missing required fields.");
  }

  // Sanitize & normalize
  return {
    bio: String(parsed.bio).trim(),
    skills: parsed.skills
      .slice(0, 12)
      .map((s: unknown) => String(s).trim())
      .filter(Boolean),
    projects: parsed.projects.map((p: { repo_name?: unknown; description?: unknown }) => ({
      repo_name: String(p.repo_name || "").trim(),
      description: String(p.description || "").trim(),
    })),
    // Pass through token count for logging
    // @ts-ignore
    _tokensUsed: tokensUsed,
  };
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  const requestOrigin = req.headers.get("origin");
  const corsHeaders   = getCorsHeaders(requestOrigin);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Init Supabase client (for DB updates) ──────────────────────────────────
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const groqApiKey = Deno.env.get("GROQ_API_KEY") || "";

  if (!groqApiKey) {
    console.error("GROQ_API_KEY not set in Edge Function environment");
    return new Response(
      JSON.stringify({ error: "Server configuration error." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let generationId = "";

  try {
    // ── Parse request body ──────────────────────────────────────────────────
    let body: GenerateRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!body.githubData?.user || !body.githubData?.repos) {
      return new Response(
        JSON.stringify({ error: "Missing githubData.user or githubData.repos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    generationId = body.generationId || "";

    // ── Rate Limiting: max 3 generations per user per 24h ──────────────────
    // بنتحقق من الـ JWT عشان نجيب الـ user_id
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (token && token !== (Deno.env.get("SUPABASE_ANON_KEY") || "")) {
      // المستخدم logged in — نتحقق من عدد الـ generations
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
        // لو فشل الـ rate limit check — نكمّل بدون حجب (fail open)
        console.warn("[generate] Rate limit check failed:", rateLimitErr);
      }
    }
    await updateGenerationStatus(supabase, generationId, "processing", {
      github_data: body.githubData,
    });

    console.log(`[generate] Starting for user: ${body.githubData.user.login}`);

    // ── Build prompt ────────────────────────────────────────────────────────
    const prompt = buildPrompt(body);

    // ── Call Groq ───────────────────────────────────────────────────────────
    const result = await callGroqAPI(prompt, groqApiKey);

    // @ts-ignore
    const tokensUsed = result._tokensUsed || 0;
    // @ts-ignore
    delete result._tokensUsed;

    console.log(
      `[generate] Success for ${body.githubData.user.login} — ${tokensUsed} tokens`
    );

    // ── Update status: completed ────────────────────────────────────────────
    await updateGenerationStatus(supabase, generationId, "completed", {
      tokens_used: tokensUsed,
    });

    // ── Return result ───────────────────────────────────────────────────────
    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    console.error("[generate] Error:", errorMessage);

    // Update status: failed
    await updateGenerationStatus(supabase, generationId, "failed", {
      error_message: errorMessage.slice(0, 500),
    });

    // Determine status code from error type
    let statusCode = 500;
    if (errorMessage.startsWith("RATE_LIMITED")) statusCode = 429;
    if (errorMessage.startsWith("AUTH_ERROR")) statusCode = 401;
    if (
      errorMessage.startsWith("PARSE_ERROR") ||
      errorMessage.startsWith("INVALID_STRUCTURE")
    )
      statusCode = 422;

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        code: errorMessage.split(":")[0],
      }),
      {
        status: statusCode,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});