// public/js/dashboard/render.js — الرسم المشترك بين تبويبات اللوحة.
// escHtml من /js/shared.js (window) — كل نص قادم من سلة أو من التاجر يمرّ به
// قبل أي innerHTML. ثغرة XSS مخزّنة أُغلقت بهذا المسار — لا تُعاد.
import { S } from "./state.js";

const escHtml = window.escHtml;

/** سطر الهوية بالشريط العلوي: أي حساب وأي متجر مفتوح الآن. */
export function renderIdentityLine() {
  const el = document.getElementById("navIdentityLine");
  if (!el) return;
  const parts = [];
  if (window.__accountEmail) parts.push(window.__accountEmail);
  if (typeof S.lastCatalogTotal === "number" && S.catalogLoadedOnce) parts.push(`${S.lastCatalogTotal} منتج مسحوب`);
  el.innerText = parts.join(" · ");
}

export function renderCopy(d) {
  const cw = d.copywriting || {};
  const seo = d.seo || {};
  document.getElementById("outDescription").value = cw.description || d.result || "";
  document.getElementById("outWhatsapp").innerText = cw.whatsapp || d.whatsapp || "";
  document.getElementById("outTitle").innerText = seo.title || "";
  document.getElementById("outSeoTitle").innerText = seo.seoTitle || "";
  document.getElementById("outSlug").innerText = seo.slug || "";
  document.getElementById("outMeta").innerText = seo.metaDescription || "";
  document.getElementById("outFocusKw").innerText = seo.focusKeyword || "";
  document.getElementById("outTags").innerText = (d.tags || []).join("، ");

  const ul = document.getElementById("outHighlights");
  ul.innerHTML = "";
  (cw.highlights || []).forEach((h) => {
    const li = document.createElement("li");
    li.innerText = h;
    ul.appendChild(li);
  });
}

/** «سينشر على: اسم المنتج» — أوضح من معرّف رقمي. الاسم من سلة ⇒ escHtml. */
export function renderPublishTarget() {
  const line = document.getElementById("publishTargetLine");
  if (!line) return;
  const t = S.selectedCatalogProduct;
  if (!t || !t.productId) { line.classList.add("hidden"); line.innerHTML = ""; return; }
  line.innerHTML = 'سينشر على: <span class="font-black">' + escHtml(t.name || t.productId) + "</span>";
  line.classList.remove("hidden");
}

/**
 * نجاح صريح بالأخضر. لا رابط منتج: سلة لا تعطينا دومين المتجر ولا رابط
 * المنتج بأي رد نستعمله هنا — فلا نخترع رابطاً (قاعدة الصدق).
 * رابط «تراجع» يظهر فقط إذا الخادم أكد revertAvailable — منتج بلا صف
 * كتالوج (رفع يدوي) لا وصف أصلياً محفوظاً له فلا نعد بتراجع لا يعمل.
 */
export function showPublishSuccess(revertAvailable, sku, onRevert) {
  const fb = document.getElementById("publishFeedback");
  fb.className = "p-3 rounded-xl text-xs font-bold bg-green-50 text-green-900 border border-green-600 space-y-1.5";
  const t = S.selectedCatalogProduct;
  // اسم المنتج من سلة ⇒ escHtml إلزامي (ثغرة XSS أُغلقت بهذا الملف).
  fb.innerHTML = "تم النشر على سلة ✅" +
    (t && t.name ? '<span class="block font-medium">حُدِّث وصف: ' + escHtml(t.name) + "</span>" : "");
  if (revertAvailable && sku) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "block text-[11px] font-bold text-rose-700 underline";
    btn.innerText = "تراجع — رجّع الأصل";
    btn.dataset.revertSku = sku;
    btn.onclick = () => onRevert(btn.dataset.revertSku);
    fb.appendChild(btn);
  }
  fb.classList.remove("hidden");
}

// رسالة الفشل يجب أن تُقرأ كخطأ (لا كإشعار محايد)، وتقول الخطوة التالية،
// وتطمئن التاجر أن نصه لم يضع — أكثر ما يخيفه عند فشل النشر أنه يعيد الكتابة.
const PUBLISH_ERRORS = {
  SALLA_RATE_LIMITED: "سلة أوقفت الطلبات مؤقتاً لأن عددها تجاوز الحد. انتظر دقيقة وجرّب مرة ثانية.",
  SALLA_NOT_CONNECTED: "متجرك غير مرتبط بسلة. افتح تبويب «متجري» واربطه، ثم أعد النشر.",
  ACCOUNT_REQUIRED: "أكمل بيانات حسابك قبل النشر على متجرك.",
  LOGIN_REQUIRED: "انتهت جلستك. سجّل دخولك من جديد ثم أعد النشر."
};

export function showPublishError(msg, code) {
  const fb = document.getElementById("publishFeedback");
  fb.className = "p-3.5 rounded-xl text-xs font-bold bg-red-50 text-red-900 border border-red-300 space-y-1";
  const text = (code && PUBLISH_ERRORS[code]) || msg || "تعذر النشر.";
  fb.innerHTML = "";
  const line = document.createElement("p");
  line.className = "font-black";
  line.innerText = "⚠︎ " + text;
  const keep = document.createElement("p");
  keep.className = "font-medium text-red-800";
  keep.innerText = "وصفك محفوظ هنا كما هو — ما ضاع شيء.";
  fb.appendChild(line);
  fb.appendChild(keep);
  fb.classList.remove("hidden");
}

export async function copyToClipboard(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = "value" in el ? el.value : el.innerText;
  try { await navigator.clipboard.writeText(text); window.showMsg("copyFeedback", "تم النسخ ✅", "success"); } catch (e) {}
}
