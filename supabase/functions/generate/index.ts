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
  generationId?: string;
}

interface GenerateResponse {
  bio: string;
  skills: string[];
  projects: {
    repo_name: string;
    description: string;
  }[];
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

// ─── Helper: Update generation status in DB ───────────────────────────────────

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

// ─── Helper: Build the Groq prompt ────────────────────────────────────────────

function buildPrompt(req: GenerateRequest): { system: string; user: string } {
  const { user, repos } = req.githubData;
  const jobTitle = req.jobTitle || "Software Developer";
  const fullName = user.name || user.login;

  const topLanguages = Object.entries(user.languages || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([lang]) => lang);

  // Rich repo summaries — more README context for better output
  const reposSummary = repos.slice(0, 6).map((r) => ({
    name: r.name,
    description: r.description || "",
    language: r.language || "",
    stars: r.stars,
    topics: (r.topics || []).slice(0, 6),
    readme_snippet: r.readme
      ? r.readme
          .slice(0, 800)
          .replace(/#{1,6}\s/g, "")
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .replace(/\n+/g, " ")
          .trim()
      : "",
  }));

  const system = `You are a world-class technical writer who specializes in developer portfolios.
Your descriptions make recruiters stop scrolling and engineers want to collaborate.
You write with precision, confidence, and specificity — never generic filler.
Every project description must answer: What problem? How? What makes it impressive?
Write in first person for the bio. Extract real details from the README and repo data.
IMPORTANT: Always respond with valid JSON only — no markdown, no backticks, no preamble.`;

  const user_prompt = `Given this GitHub profile data, generate portfolio content that stands out:

Developer: ${fullName}
Job Title: ${jobTitle}
GitHub Username: ${user.login}
Followers: ${user.followers}
Public Repos: ${user.public_repos}
Primary Languages: ${topLanguages.join(", ")}
GitHub Bio: ${user.bio || "Not provided"}

Top Repositories (read readme_snippet carefully before writing each description):
${JSON.stringify(reposSummary, null, 2)}

Generate ONLY this JSON structure (no extra text):
{
  "bio": "2-3 sentences. Open with what you BUILD, not who you are. Name the specific technologies from their actual repos. End with something human — a philosophy, a focus area, or what drives their work. Must feel specific to THIS developer.",
  "skills": ["skill1", "skill2", ...],
  "projects": [
    {
      "repo_name": "exact repo name from the list above",
      "description": "Sentence 1: What problem this solves and who benefits — be concrete, use numbers or scale if visible in the readme. Sentence 2: The technical approach — name the exact stack, architecture decisions, or clever solutions extracted from the readme_snippet. If the repo has stars, mention them naturally."
    }
  ]
}

Strict rules:
- bio: BANNED words — passionate, love coding, enthusiastic, dedicated, aspiring, driven
- bio: must reference specific technologies and projects visible in the repos
- skills: max 12, only skills actually present in repos/languages — no guessing
- projects: all ${repos.slice(0, 6).length} repos in same order
- project descriptions: mine the readme_snippet for real details — tech choices, features, architecture
- if readme_snippet is empty, use name + description + language + topics to reconstruct what it does
- every description must feel distinct — no repeated sentence structures
- descriptions are 2 strong specific sentences, not 2 vague generic ones`;

  return { system, user: user_prompt };
}

// ─── Helper: Call Groq API ─────────────────────────────────────────────────────

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
      max_tokens: 2500,
      temperature: 0.65,
      top_p: 0.9,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Groq API error:", response.status, errorBody);
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

  let parsed: GenerateResponse;
  try {
    parsed = JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("PARSE_ERROR: Could not parse AI response as JSON.");
    parsed = JSON.parse(jsonMatch[0]);
  }

  if (!parsed.bio || !Array.isArray(parsed.skills) || !Array.isArray(parsed.projects)) {
    throw new Error("INVALID_STRUCTURE: AI response missing required fields.");
  }

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
    // @ts-ignore
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
    let body: GenerateRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON in request body." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!body.githubData?.user || !body.githubData?.repos) {
      return new Response(
        JSON.stringify({ error: "Missing githubData.user or githubData.repos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    generationId = body.generationId || "";

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
        console.warn("[generate] Rate limit check failed:", rateLimitErr);
      }
    }

    await updateGenerationStatus(supabase, generationId, "processing", {
      github_data: body.githubData,
    });

    console.log(`[generate] Starting for user: ${body.githubData.user.login}`);

    const prompt = buildPrompt(body);
    const result = await callGroqAPI(prompt, groqApiKey);

    // @ts-ignore
    const tokensUsed = result._tokensUsed || 0;
    // @ts-ignore
    delete result._tokensUsed;

    console.log(`[generate] Success for ${body.githubData.user.login} — ${tokensUsed} tokens`);

    await updateGenerationStatus(supabase, generationId, "completed", {
      tokens_used: tokensUsed,
    });

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[generate] Error:", errorMessage);

    await updateGenerationStatus(supabase, generationId, "failed", {
      error_message: errorMessage.slice(0, 500),
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
