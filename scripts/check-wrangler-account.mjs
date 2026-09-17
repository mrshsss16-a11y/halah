#!/usr/bin/env node
/**
 * حارس النشر (OPS-1): يمنع النشر بحساب Cloudflare خاطئ.
 *
 * 2026-09-17: `wrangler pages deploy` يستخدم أي حساب يجده — CLOUDFLARE_API_TOKEN
 * بالبيئة أو جلسة OAuth محفوظة. لو كان التوكن لحساب آخر (تجريبي/شخصي) ينشر هناك
 * بصمت ولا أحد يلاحظ حتى يفحص الدومين الحي. هذا السكربت يشغّل `wrangler whoami`
 * بمعزل عن CLOUDFLARE_API_TOKEN (يجبر استخدام جلسة OAuth المسجَّلة بالجهاز) ويقارن
 * معرّف الحساب الظاهر بالمعرّف المتوقَّع؛ أي فرق أو تعذّر قراءة = توقف قبل النشر.
 * WP-A6 / OPS-1.
 */
import { spawnSync } from "node:child_process";

// ليس سرّاً — معرّف حساب Cloudflare (مثل رقم حساب)، لا صلاحيات فيه بمفرده.
export const EXPECTED_ACCOUNT_ID = "d1d225ac2dc19ecc3942e26056e6478c";

/**
 * parseAccountId(output) — يستخرج معرّف الحساب من ناتج جدول `wrangler whoami`.
 * الشكل المعروف: عمود "Account Name" وعمود "Account ID" داخل جدول ASCII، مثال:
 * │ My Account │ d1d225ac2dc19ecc3942e26056e6478c │
 * نرجّع أول تطابق لنمط هكس ٣٢ حرفاً (شكل معرّفات حسابات Cloudflare)، أو null.
 */
export function parseAccountId(output) {
  if (typeof output !== "string" || output.length === 0) return null;
  const match = output.match(/\b[0-9a-f]{32}\b/i);
  return match ? match[0].toLowerCase() : null;
}

function last4(id) {
  if (!id || id.length < 4) return "????";
  return id.slice(-4);
}

async function main() {
  const hasToken = !!process.env.CLOUDFLARE_API_TOKEN;
  const allowToken = process.env.HALA_ALLOW_TOKEN === "1";

  if (hasToken && !allowToken) {
    // تحذير فقط (لا نطبع القيمة) — الغاية إجبار استخدام OAuth ما لم يُطلب صراحة خلاف ذلك.
    console.warn(
      "⚠ CLOUDFLARE_API_TOKEN موجود بالبيئة — سيُستبعد من فحص الحساب هذا (استخدم HALA_ALLOW_TOKEN=1 لتضمينه عمداً)."
    );
  } else if (hasToken && allowToken) {
    console.warn("⚠ CLOUDFLARE_API_TOKEN موجود ومُستخدَم عمداً (HALA_ALLOW_TOKEN=1).");
  }

  const childEnv = { ...process.env };
  if (!allowToken) delete childEnv.CLOUDFLARE_API_TOKEN;

  const result = spawnSync("npx", ["wrangler", "whoami"], {
    env: childEnv,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (result.error || result.status !== 0) {
    console.error("✖ تعذّر تشغيل `wrangler whoami` — لا يمكن التحقق من الحساب. توقف قبل النشر.");
    process.exit(1);
    return;
  }

  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const foundId = parseAccountId(output);

  if (!foundId) {
    console.error("✖ تعذّر استخراج معرّف الحساب من ناتج `wrangler whoami`. توقف قبل النشر.");
    process.exit(1);
    return;
  }

  if (foundId !== EXPECTED_ACCOUNT_ID.toLowerCase()) {
    console.error(
      `✖ حساب Cloudflare غير متوقَّع — ينتهي بـ …${last4(foundId)} (المتوقَّع ينتهي بـ …${last4(
        EXPECTED_ACCOUNT_ID
      )}). توقف قبل النشر.`
    );
    process.exit(1);
    return;
  }

  console.log(`✓ حساب Cloudflare مطابق (…${last4(foundId)}).`);
}

// شغّل main() فقط عند التنفيذ المباشر (لا عند import من الاختبارات).
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  main();
}
