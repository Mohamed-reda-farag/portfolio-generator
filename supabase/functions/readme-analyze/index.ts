// supabase/functions/readme-analyze/index.ts
// README Analyzer — Portfolio Generator
// Receives README content → builds prompt per output type → calls Groq → returns JSON

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LinkedInPost {
  post: string;
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
  bio?:            string;
  project?:        string;
  linkedin_posts?: LinkedInPost[];
  report?:         LinkedInReport;
  skills?:         string[];
}

interface AnalyzeRequest {
  readmeContent:    string;
  requestedOutputs: string[];
  userId?:          string;
}

// ─── CORS (نفس نمط generate/index.ts) ────────────────────────────────────────

const ALLOWED_ORIGINS = [
  "https://portfolio-generator-taupe.vercel.app",
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
  bio: `Write a professional developer bio of 150-200 words based on this project.
Focus on the expertise implied by the tech stack, architecture decisions, and project goals.
Write in first person. Avoid generic filler words like "passionate", "love coding", "dedicated".
Lead with what the developer BUILDS, not who they are. End with something specific to this project.
Return as a plain string under the key "bio".`,

  project: `Write a compelling project description of 100-150 words suitable for a developer portfolio.
Sentence 1: What problem does this project solve and who benefits — be concrete.
Sentence 2: The technical approach — name the exact stack, architecture, or clever solutions visible in the README.
Avoid vague language. If there are metrics, numbers, or scale indicators in the README, include them.
Return as a plain string under the key "project".`,

  linkedin_posts: `Create exactly 3 LinkedIn posts about this project.
Each post should be 150-200 words, professional yet engaging tone, and include relevant hashtags.
Each post should take a different angle:
  - Post 1: The problem you solved and its impact
  - Post 2: The technical learnings and stack choices
  - Post 3: A lesson or insight for other developers
Return as a JSON array under the key "linkedin_posts", where each item is:
{ "post": "...", "hashtags": ["hashtag1", "hashtag2", ...] }`,

  report: `Generate a LinkedIn Presence Report for a developer who built this project.
Include:
  - profile_strength_score: integer 0-100
  - key_strengths: array of 3-4 strings describing what this project demonstrates
  - recommended_keywords: array of 8-12 LinkedIn keywords to optimize the profile
  - industry_benchmark: 1-2 sentences comparing this project's scope to typical industry standards
  - improvement_tips: array of exactly 3 actionable tips to strengthen the LinkedIn presence
Return as a JSON object under the key "report".`,

  skills: `Extract ALL technologies, frameworks, languages, tools, platforms, and libraries
mentioned or clearly implied in this README.
Include programming languages, frameworks, databases, cloud services, dev tools, testing libraries, etc.
Return as a flat JSON array of strings under the key "skills".
Example: ["React", "Node.js", "PostgreSQL", "Docker", "Jest"]`,
};

// ─── Build prompt ──────────────────────────────────────────────────────────────
//
// Design decision: نبني prompt واحد بدل multiple API calls عشان:
// 1. أسرع وأرخص من حيث الـ tokens
// 2. الـ model يشوف الـ README مرة واحدة بس ويولّد كل الـ outputs معاً
// 3. أسهل في الـ error handling

function buildPrompt(
  readmeContent: string,
  requestedOutputs: string[]
): { system: string; user: string } {

  const system = `You are an expert technical writer, LinkedIn content strategist, and developer advocate.
You analyze README files from software projects and generate professional, high-quality content.
Your writing is specific, concrete, and avoids generic filler phrases.
You extract real details from READMEs — tech stack, architecture decisions, use cases, metrics.

CRITICAL: Respond ONLY with a single valid JSON object. No markdown, no backticks, no preamble, no explanation.
The JSON object must contain only the keys that were requested.`;

  // Build instructions section per requested output
  const outputInstructions = requestedOutputs
    .filter(key => OUTPUT_PROMPTS[key])
    .map(key => `### ${key.toUpperCase()}\n${OUTPUT_PROMPTS[key]}`)
    .join('\n\n');

  const user = `Here is the README content to analyze:
---BEGIN README---
${readmeContent.slice(0, 15000)}
---END README---

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
      max_tokens:      4000,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(35_000), // 35s — أطول قليلاً من generate عشان الـ output أكتر
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

serve(async (req: Request) => {
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
  const { readmeContent, requestedOutputs, userId } = body;

  if (!readmeContent?.trim()) {
    return new Response(
      JSON.stringify({ error: "readmeContent is required and cannot be empty." }),
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
    console.log(`[readme-analyze] Processing ${filteredKeys.join(", ")} for user: ${userId || "anon"}`);

    const prompt = buildPrompt(readmeContent, filteredKeys);
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
