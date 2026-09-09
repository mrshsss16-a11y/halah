// مجال الحصص: الاستدعاء المجالي للعدّاد.
//
// `core/meter.js` يبقى **بنية تحتية** (آلية العدّ نفسها: KV + usage_meter)؛
// هذا الملف هو الوجه المجالي فوقها — ما يستدعيه الأدمن/المسارات لا آلية العدّ.
// نُقل `resetMerchantQuota` من core/db.js بالمرحلة ٣ بلا تغيير سلوكي.

export async function resetMerchantQuota(env, merchantId) {
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  await env.DB.prepare(
    "INSERT INTO usage_meter (merchant_id, day, credits_used, updated_at) VALUES (?, ?, 0, datetime('now')) ON CONFLICT (merchant_id, day) DO UPDATE SET credits_used = 0, updated_at = datetime('now')"
  ).bind(merchantId, todayStr).run();

  if (env.HALA_CACHE) {
    await env.HALA_CACHE.put(`meter:${merchantId}:${todayStr}`, "0", { expirationTtl: 25 * 3600 }).catch(() => {});
  }
}
