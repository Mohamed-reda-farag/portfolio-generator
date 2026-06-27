// supabase/functions/improve-text/index.ts
// ─────────────────────────────────────────────────────────────────────────
// Edge Function: improve-text
//
// بتاخد bio أو skills وترجع نسخة محسّنة/مقترحة باستخدام Groq — نفس مزوّد
// الـ AI المستخدم في "generate" (استنتجته من GROQ_ERROR الموجودة في ai.js).
//
// Contract اللي بيتوقعه js/portfolio-builder.js (دالة improveWithAI):
//   POST body: { fieldType: 'bio' | 'skills', currentValue: string, context: object }
//   success (200): { success: true, suggestion: string }
//   error   (4xx/5xx): { success: false, error: string, code: string }
//
// قبل الديبلوي، لازم تضبط الـ secret:
//   supabase secrets set GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxx
//
// الديبلوي:
//   supabase functions deploy improve-text
// ─────────────────────────────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// قابل للتغيير من غير إعادة ديبلوي (Deno.env.get) — افتراضيًا موديل قوي
// لإعادة كتابة نص بشكل جيد. غيّره بـ "supabase secrets set GROQ_MODEL=..."
// لو عايز موديل أسرع/أرخص.
const GROQ_MODEL = Deno.env.get("GROQ_MODEL") || "llama-3.3-70b-versatile";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");

const SYSTEM_PROMPTS: Record<string, string> = {
  bio:
    "You are a concise professional copywriter who rewrites developer " +
    "portfolio bios. Output ONLY the improved bio — 2 to 3 punchy sentences, " +
    "under 400 characters, first-person voice. No preamble, no quotes, no markdown.",
  skills:
    "You suggest relevant technical skills for a developer's portfolio based " +
    "on their job title and current skills. Output ONLY a comma-separated list " +
    "of 5 to 8 additional skill names NOT already in their current list — " +
    "no numbering, no explanation, no preamble.",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function buildUserPrompt(
  fieldType: string,
  currentValue: string,
  context: Record<string, unknown>,
): string {
  if (fieldType === "bio") {
    const skills = Array.isArray(context.skills) ? context.skills.join(", ") : "";
    return [
      `Job title: ${context.jobTitle || "Developer"}`,
      `Name: ${context.name || ""}`,
      `Skills: ${skills}`,
      `Current bio draft: """${currentValue || "(empty — write one from scratch)"}"""`,
      "",
      "Rewrite this into a polished, confident portfolio bio.",
    ].join("\n");
  }
  return [
    `Job title: ${context.jobTitle || "Developer"}`,
    `Current skills: ${currentValue || "(none yet)"}`,
    "Suggest additional relevant technical skills for this role.",
  ].join("\n");
}

/** بينضف ناتج الموديل لقائمة skills بسيطة comma-separated */
function cleanSkillsList(raw: string): string {
  return raw
    .split(/[,\n]/)
    .map((s) => s.replace(/^[\s\-*\d.]+/, "").trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(", ");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (!GROQ_API_KEY) {
    console.error("[improve-text] GROQ_API_KEY غير مضبوطة كـ secret");
    return json(
      { success: false, error: "Server configuration issue.", code: "AUTH_ERROR" },
      500,
    );
  }

  let payload: { fieldType?: string; currentValue?: string; context?: Record<string, unknown> };
  try {
    payload = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body.", code: "PARSE_ERROR" }, 400);
  }

  const { fieldType, currentValue = "", context = {} } = payload;

  if (fieldType !== "bio" && fieldType !== "skills") {
    return json(
      { success: false, error: "fieldType must be 'bio' or 'skills'.", code: "INVALID_STRUCTURE" },
      400,
    );
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.7,
        max_tokens: fieldType === "bio" ? 220 : 120,
        messages: [
          { role: "system", content: SYSTEM_PROMPTS[fieldType] },
          { role: "user", content: buildUserPrompt(fieldType, currentValue, context) },
        ],
      }),
    });

    if (response.status === 429) {
      return json({ success: false, error: "Rate limited.", code: "RATE_LIMITED" }, 429);
    }
    if (!response.ok) {
      const errText = await response.text();
      console.error("[improve-text] Groq error:", response.status, errText);
      return json({ success: false, error: "AI service error.", code: "GROQ_ERROR" }, 502);
    }

    const data = await response.json();
    const raw: string | undefined = data?.choices?.[0]?.message?.content?.trim();

    if (!raw) {
      return json({ success: false, error: "Empty AI response.", code: "PARSE_ERROR" }, 502);
    }

    const suggestion = fieldType === "skills" ? cleanSkillsList(raw) : raw;
    return json({ success: true, suggestion });

  } catch (err) {
    console.error("[improve-text] unexpected error:", err);
    return json({ success: false, error: "Unexpected server error.", code: "DEFAULT" }, 500);
  }
});
