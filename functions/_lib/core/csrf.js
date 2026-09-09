// P42 — حماية CSRF لكل نقطة تغيير حالة (docs/SECURITY_PLAN.md حرج ٤).
//
// لماذا نحتاجها: كوكي الجلسة `SameSite=None` (إلزامي لإطار سلة) يُرسَل مع أي طلب من أي
// موقع. نموذج HTML بـ`enctype="text/plain"` من موقع خارجي لا يستدعي preflight، يحمل
// الكوكي، ويُنتج جسماً يفكّه `request.json()` — الكتابة تنجح والمهاجم لا يحتاج قراءة الرد.
//
// الدفاع بطبقتين، كلتاهما بنقطة واحدة (withApi + المعالجات الخام):
//  ١. **Origin/Sec-Fetch-Site**: طلب متصفح عابر المواقع يحمل `Origin` دائماً — نقبل فقط
//     أصلنا نفسه، دومينات المشروع، وإطار سلة. غياب `Origin` مع `Sec-Fetch-Site: cross-site`
//     يُرفض أيضاً. غيابهما معاً = عميل غير متصفح (curl، cron-worker) — يمرّ، لأنه لا يحمل
//     كوكي ضحية أصلاً (المتصفح وحده يرفق الكوكي تلقائياً).
//  ٢. **Content-Type**: أي جسم غير فارغ لازم يكون `application/json`. النماذج لا تقدر
//     ترسل هذا النوع بلا preflight، وpreflight مسدود (لا CORS إلا للودجت بقائمته).
//
// لا تُطبَّق على الويبهوكات (توقيع HMAC هو حارسها) — هي لا تمر بهذه الدالة أصلاً.
import { ApiError } from "./respond.js";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** أصول المشروع الثابتة + أي أصل إضافي من البيئة (فاصلة). */
function projectOrigins(env) {
  const extra = String(env?.TRUSTED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // aura.sa وwww.aura.sa: موقع أورا نفسه يستضيف ودجت الدعم (/api/support).
  // رُصد بسجل الأخطاء 2026-09-08: CSRF_REJECTED لأصل aura.sa ⇒ ودجت الموقع
  // الحي كان محجوباً منذ تفعيل بوابة CSRF. نطاقان يملكهما المشروع، لا أسرار.
  return new Set([
    "https://halah.aura.sa",
    "https://aura.sa",
    "https://www.aura.sa",
    "https://hala-ai-os.pages.dev",
    "https://s.salla.sa",
    ...extra
  ]);
}

function originAllowed(origin, requestOrigin, env, extraAllowed) {
  if (origin === requestOrigin) return true; // نفس الأصل — الحالة الطبيعية
  if (projectOrigins(env).has(origin)) return true;
  if (extraAllowed.includes(origin)) return true;
  let host;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:") return false;
    host = u.hostname;
  } catch {
    return false;
  }
  // نشرات المعاينة (<hash>.hala-ai-os.pages.dev) وإطار سلة بأي نطاق فرعي.
  return host.endsWith(".hala-ai-os.pages.dev") || host.endsWith(".salla.sa");
}

/**
 * يرمي ApiError(403 CSRF_REJECTED) أو ApiError(415 UNSUPPORTED_MEDIA_TYPE).
 * `allowedOrigins`: أصول إضافية لنقطة بعينها (ودجت الموقع بقائمة CORS الخاصة به).
 */
export function assertTrustedWrite(request, env, { allowedOrigins = [] } = {}) {
  if (!WRITE_METHODS.has(request.method)) return;

  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  const fetchSite = (request.headers.get("Sec-Fetch-Site") || "").toLowerCase();

  if (origin) {
    if (!originAllowed(origin, requestOrigin, env, allowedOrigins)) {
      throw new ApiError(403, "الطلب مرفوض — مصدر غير موثوق.", "CSRF_REJECTED", `origin ${origin} not allowed for ${requestOrigin}`);
    }
  } else if (fetchSite === "cross-site") {
    throw new ApiError(403, "الطلب مرفوض — مصدر غير موثوق.", "CSRF_REJECTED", "Sec-Fetch-Site=cross-site without Origin");
  }

  const contentType = (request.headers.get("Content-Type") || "").toLowerCase();
  const contentLength = request.headers.get("Content-Length");
  const hasBody = contentType !== "" || (contentLength !== null && contentLength !== "0");
  if (hasBody && !contentType.startsWith("application/json")) {
    throw new ApiError(415, "الطلب لازم يكون بصيغة JSON.", "UNSUPPORTED_MEDIA_TYPE", `content-type ${contentType || "(none)"}`);
  }
}
