/**
 * check-expired-subscriptions/index.ts
 *
 * Supabase Edge Function — تُشغَّل يومياً (Cron / Webhook)
 * المهمة:
 *   1. تجيب كل المستخدمين الـ Pro اللي انتهى اشتراكهم
 *   2. تعمل is_pro = FALSE
 *   3. لو الـ portfolio بتاعهم بيستخدم Pro theme → تحفظ الـ theme وتنزّله لـ dark
 *
 * تشغيل يدوي:
 *   curl -X POST \
 *     https://<ref>.supabase.co/functions/v1/check-expired-subscriptions \
 *     -H "Authorization: Bearer <service_role_key>"
 *
 * Cron (في supabase/config.toml):
 *   [functions.check-expired-subscriptions]
 *   verify_jwt = false
 *   schedule = "0 3 * * *"   # كل يوم الساعة 3 صباحاً UTC
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── Theme Classification ────────────────────────────────────────────────────

const PRO_THEMES     = ['glass3d', 'cyberpunk', 'space', 'editorial', 'noir', 'blueprint', 'terminal', 'liquid'];
const DEFAULT_FREE_THEME = 'dark';

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {

  // Allow only POST (or GET for health checks)
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // ─── Supabase Admin Client (Service Role) ─────────────────────────────────
  // Service Role Key مطلوب عشان نعمل UPDATE على جميع المستخدمين
  const supabaseUrl     = Deno.env.get('SUPABASE_URL')             ?? '';
  const serviceRoleKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: 'Missing env vars: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ─── 1. جيب المستخدمين المنتهية اشتراكاتهم ──────────────────────────────

  const now = new Date().toISOString();

  /*
   * الشرط: المستخدم Pro (is_pro = true) لكن:
   *   - pro_expires_at انتهى (أو)
   *   - early_adopter_expires_at انتهى
   * ملاحظة: لو كلاهم null → لا ننزّله (Pro مدى الحياة يدوي)
   */
  const { data: expiredUsers, error: fetchErr } = await sb
    .from('users')
    .select('id, is_pro, pro_expires_at, early_adopter_expires_at')
    .eq('is_pro', true)
    .or(
      `and(pro_expires_at.not.is.null,pro_expires_at.lt.${now}),` +
      `and(early_adopter_expires_at.not.is.null,early_adopter_expires_at.lt.${now})`
    );

  if (fetchErr) {
    console.error('[check-expired] fetch error:', fetchErr.message);
    return new Response(
      JSON.stringify({ error: fetchErr.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!expiredUsers || expiredUsers.length === 0) {
    return new Response(
      JSON.stringify({ downgraded: 0, message: 'No expired subscriptions found.' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ─── 2. عالج كل مستخدم ──────────────────────────────────────────────────

  let downgraded     = 0;
  const errors: string[] = [];

  for (const user of expiredUsers) {
    try {
      // 2a. is_pro = FALSE
      const { error: updateUserErr } = await sb
        .from('users')
        .update({ is_pro: false })
        .eq('id', user.id);

      if (updateUserErr) {
        errors.push(`user ${user.id}: ${updateUserErr.message}`);
        continue;
      }

      // 2b. جيب الـ portfolio بتاعه
      const { data: portfolio, error: portFetchErr } = await sb
        .from('portfolios')
        .select('id, theme')
        .eq('user_id', user.id)
        .single();

      if (portFetchErr || !portfolio) {
        // مش لازم يكون عنده portfolio — مش خطأ
        downgraded++;
        continue;
      }

      // 2c. لو بيستخدم Pro theme → احفظه ونزّله لـ dark
      if (PRO_THEMES.includes(portfolio.theme)) {
        const { error: portUpdateErr } = await sb
          .from('portfolios')
          .update({
            last_pro_theme: portfolio.theme,
            theme:          DEFAULT_FREE_THEME,
          })
          .eq('user_id', user.id);

        if (portUpdateErr) {
          errors.push(`portfolio for user ${user.id}: ${portUpdateErr.message}`);
          // عدّينا الـ user رغم الـ portfolio error
        }
      }

      downgraded++;

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`user ${user.id}: unexpected error — ${msg}`);
    }
  }

  // ─── 3. الرد ─────────────────────────────────────────────────────────────

  const response = {
    downgraded,
    total:    expiredUsers.length,
    errors:   errors.length > 0 ? errors : undefined,
    message:  `${downgraded} subscription(s) expired and downgraded.`,
    timestamp: now,
  };

  console.log('[check-expired] Done:', response);

  return new Response(
    JSON.stringify(response),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
