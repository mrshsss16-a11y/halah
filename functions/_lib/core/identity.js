// قراءتا الهوية الأساسيتان: صف `merchants` وبريد `accounts`.
//
// لماذا بـ`core/` لا بـ`domain/accounts.js`: `core/session.js` يحتاجهما لبناء
// الجلسة نفسها (التحقق أن المعرّف المُدّعى يخصّ حساباً، وقراءة اسم المتجر
// والبريد للتوجيه). بقاؤهما بـdomain كان يجبر `core` على استيراد `domain`
// وهو خرق قاعدة الاتجاه ق١ (ARCHITECTURE.md §١) — وكان مغطّى باستثناء
// مؤقت عبر shim `core/db.js` حتى المرحلة ٦.
//
// هما «أدوات عامة» بمعنى §١ حرفياً: قراءة صف واحد بمفتاحه الأساسي، صفر منطق
// أعمال، صفر قرار. أي منطق حسابات (مقاعد التجربة، التعطيل، ربط جوجل، التطبيع)
// يبقى بـ`domain/accounts.js`. **مصدر واحد** لهذين الاستعلامين — لا تنسخهما.
//
// نُقلا من `domain/accounts.js` بالمرحلة ٦ بلا أي تغيير سلوكي (نفس SQL حرفياً).

export async function getMerchant(env, merchantId) {
  return env.DB.prepare("SELECT * FROM merchants WHERE id = ?").bind(merchantId).first();
}

export async function getAccountEmail(env, merchantId) {
  const row = await env.DB.prepare("SELECT email FROM accounts WHERE merchant_id = ?")
    .bind(merchantId)
    .first();
  return row ? row.email : null;
}
