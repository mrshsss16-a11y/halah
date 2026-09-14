// رمز ربط بجوجل لمرة واحدة (2026-09-14).
//
// لماذا: زر جوجل داخل إطار سلة لم يظهر لتاجر حقيقي (قيود المتصفح على تسجيل الدخول داخل إطار طرف ثالث)،
// فالدخول يتم بنافذة مستقلة على موقعنا. كوكي جلستنا داخل الإطار مقسَّم (Partitioned) تحت سلة، فالنافذة
// المستقلة لا تراه — لذلك يُصدر الإطار (وجلسته مثبتة) رمزاً عشوائياً قصير العمر يحمل صف المتجر، وتقدّمه
// النافذة مع رد جوجل. الرمز يُستهلك مرة واحدة ويُحذف، ولا يحمل إلا معرّف صف المتجر داخل KV.
const PREFIX = "glink:";
const TTL_SECONDS = 300;
const NONCE_RE = /^[0-9a-f]{48}$/;

export async function createGoogleLinkNonce(env, storeMerchantId) {
  if (!env?.HALA_CACHE || !storeMerchantId) throw new Error("google link: KV or store missing");
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  await env.HALA_CACHE.put(PREFIX + nonce, String(storeMerchantId), { expirationTtl: TTL_SECONDS });
  return nonce;
}

/** يرجّع صف المتجر ويحذف الرمز، أو null لرمز غير صالح أو منتهٍ أو مستعمل. */
export async function consumeGoogleLinkNonce(env, nonce) {
  const n = String(nonce || "");
  if (!NONCE_RE.test(n) || !env?.HALA_CACHE) return null;
  const key = PREFIX + n;
  const storeMerchantId = await env.HALA_CACHE.get(key);
  if (!storeMerchantId) return null;
  await env.HALA_CACHE.delete(key);
  return storeMerchantId;
}
