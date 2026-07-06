// supabase/functions/github-proxy/index.ts
// GitHub API Proxy — Portfolio Generator
//
// [FIXED] جزء من حل مشكلة "العالق على نفس الريبو" — كانت كل نداءات GitHub
// API بتتم من المتصفح مباشرة بدون أي مصادقة، وده بيحطها تحت حد GitHub
// الرسمي لغير المُصادَق عليهم: 60 نداء/ساعة للـ IP الواحد. تشغيلة واحدة من
// "Auto Generate from GitHub Repos" كانت تقريبًا تستهلك ~70% من الحد ده،
// فأي إعادة محاولة كانت تضرب 429/403 بسهولة، والكود القديم كان بيبلّع
// الفشل ده بصمت (بيرجع "مفيش بيانات" بدل "اتضربنا بالحد").
//
// الحل: هذا الـ edge function بيحمل GitHub token من env server-side،
// ويعمل الطلب لـ api.github.com بالنيابة عن العميل — فيرفع الحد لـ
// 5000/ساعة (budget مُصادَق عليه، مشترك بين كل مستخدمي الموقع).
//
// أمان: الـ proxy مقصور على مسارات مُحدَّدة سلفًا (allow-list) بس — عشان
// مايتحولش لـ "افتح أي URL على الإنترنت باسمنا واستخدم توكننا" (SSRF-ish
// risk). التوكن نفسه لا يحتاج أي scope خاص — بيانات عامة (public) بس.

const ALLOWED_ORIGINS = [
  "https://portfolio-generator-taupe.vercel.app",
  "http://127.0.0.1:5500",   // Live Server — تطوير محلي فقط
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

const GH_BASE = "https://api.github.com";

// ── Allow-list — بس المسارات اللي github.js فعليًا بيستخدمها ──────────────
// أي path تاني بيُرفض بـ 400، حتى لو التوكن نفسه عنده صلاحيات أوسع.
const ALLOWED_PATH_PATTERNS: RegExp[] = [
  /^\/users\/[a-zA-Z0-9-]+$/,
  /^\/users\/[a-zA-Z0-9-]+\/repos(\?.*)?$/,
  /^\/repos\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+\/readme$/,
  /^\/repos\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+\/languages$/,
  /^\/rate_limit$/,
];

interface ProxyRequest {
  path?: string;
}

Deno.serve(async (req: Request) => {
  const requestOrigin = req.headers.get("origin");
  const corsHeaders   = getCorsHeaders(requestOrigin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const token = Deno.env.get("GITHUB_TOKEN") || "";
  if (!token) {
    return new Response(
      JSON.stringify({ error: "Server configuration error: missing GITHUB_TOKEN" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let body: ProxyRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON in request body." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const path = body.path || "";
  if (!path.startsWith("/") || !ALLOWED_PATH_PATTERNS.some(p => p.test(path))) {
    return new Response(
      JSON.stringify({ error: "Path not allowed." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const ghRes = await fetch(`${GH_BASE}${path}`, {
      headers: {
        "Accept":        "application/vnd.github.v3+json",
        "Authorization": `Bearer ${token}`,
        "User-Agent":    "portfolio-generator-proxy",
      },
      signal: AbortSignal.timeout(10_000),
    });

    const remaining = ghRes.headers.get("X-RateLimit-Remaining");
    const reset     = ghRes.headers.get("X-RateLimit-Reset");

    let parsedBody: unknown = null;
    const text = await ghRes.text();
    if (text) {
      try { parsedBody = JSON.parse(text); } catch { parsedBody = null; }
    }

    // [FIXED] دايمًا بنرجّع 200 من الـ proxy نفسه، والرد الحقيقي من GitHub
    // (status/headers/body) جوه envelope — عشان sb.functions.invoke() في
    // العميل يرجّع { data, error: null } بشكل موحّد لأي نتيجة، وghFetch()
    // في github.js يقدر يفحص status الحقيقي بنفس منطقه القديم بالضبط.
    return new Response(
      JSON.stringify({
        status:  ghRes.status,
        headers: {
          "x-ratelimit-remaining": remaining,
          "x-ratelimit-reset":     reset,
        },
        body: parsedBody,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[github-proxy] Upstream fetch failed:", message);
    return new Response(
      JSON.stringify({ error: `Proxy fetch failed: ${message}` }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
