#!/usr/bin/env node
/**
 * يتحقق من صلاحية توكن واتساب قبل حفظه بأسرار Cloudflare.
 * يمنع الحالة المزعجة: تحفظ توكناً غلط، تنشر، وتكتشف الفشل من رسالة عميل حقيقية.
 *
 *   WHATSAPP_TOKEN=xxx WHATSAPP_PHONE_ID=xxx node scripts/verify-wa-token.mjs
 */

const token = process.env.WHATSAPP_TOKEN;
const phoneId = process.env.WHATSAPP_PHONE_ID;

if (!token || !phoneId) {
  console.error('✖ مرّر WHATSAPP_TOKEN و WHATSAPP_PHONE_ID كمتغيرات بيئة أولاً.');
  console.error('  مثال: WHATSAPP_TOKEN=xxx WHATSAPP_PHONE_ID=xxx node scripts/verify-wa-token.mjs');
  process.exit(1);
}

const url = `https://graph.facebook.com/v21.0/${phoneId}?fields=verified_name,display_phone_number,quality_rating`;

console.log('📞 التحقق من التوكن مقابل Graph API...');

try {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json();

  if (!res.ok) {
    console.error(`✖ التوكن مرفوض (HTTP ${res.status}):`);
    console.error(JSON.stringify(body, null, 2));
    process.exit(1);
  }

  console.log('✔ التوكن صالح:');
  console.log(`  الاسم الموثّق: ${body.verified_name || '—'}`);
  console.log(`  الرقم: ${body.display_phone_number || '—'}`);
  console.log(`  جودة الحساب: ${body.quality_rating || '—'}`);
  console.log('\nآمن الآن لحفظه:');
  console.log('  npx wrangler pages secret put WHATSAPP_TOKEN --project-name hala-ai-os');
  console.log('  npm run deploy   # الأسرار تُفعَّل فقط بعد نشرة جديدة');
} catch (err) {
  console.error('✖ فشل الاتصال بـGraph API:', err.message);
  process.exit(1);
}
