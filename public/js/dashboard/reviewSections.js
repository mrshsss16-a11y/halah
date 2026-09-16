// public/js/dashboard/reviewSections.js — أقسام صفحة المنتج الجديدة بخطوة المراجعة (طلب المالك 2026-09-14):
// كل حقل تكتبه هالة وتنشره على سلة يظهر هنا قابلاً للتعديل — الوصف، النبذة، نقاط البيع، المواصفات، الأسئلة
// الشائعة، عنوان السيو ووصف الميتا — ولكل قسم (عدا الوصف) مفتاح «ينشر / لا ينشر» يطابق exclude بالخادم.
//
// كل نص من سلة أو النموذج يمرّ بـescHtml قبل أي HTML (ح٧). لا onclick مضمَّن: الإضافة/الحذف بتفويض أحداث
// على #rmBody (reviewModal.js) عبر data-rm-action.
const escHtml = (v) => window.escHtml(v);

export const SEO_TITLE_MAX = 60;
export const META_MAX = 160;
const LIMITS = { highlights: 8, faqs: 8, specsTable: 15 };

// HTML للقراءة فقط من وصف سلة الحالي («قبل») — عناصر بقائمة سماح وبلا أي خصائص (§3 DESIGN_SPEC).
// script/style/iframe/… تُزال كاملة، وأي وسم آخر خارج القائمة يُفكّ (يبقى محتواه لا وسمه)، بلا أي خاصية HTML.
const ALLOWED_TAGS = new Set(["P", "BR", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "STRONG", "EM", "B", "I"]);
const STRIP_TAGS = ["script", "style", "iframe", "object", "embed", "link", "meta", "svg", "form", "input"];

function sanitizeWithDom(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  doc.querySelectorAll(STRIP_TAGS.join(",")).forEach((n) => n.remove());
  // 2026-09-17: تعليقات HTML (<!-- ... -->) قد تُستغل لتهريب نص غير مقصود عبر
  // شرط conditional comments بمتصفحات قديمة — تُزال قبل المشي على العناصر،
  // مطابقةً لمسار sanitizeWithoutDom الذي يحذفها بالفعل.
  const commentIter = doc.createNodeIterator(doc.body, NodeFilter.SHOW_COMMENT);
  const comments = [];
  let c;
  while ((c = commentIter.nextNode())) comments.push(c);
  comments.forEach((n) => n.remove());
  const walk = (node) => {
    [...node.children].forEach((el) => {
      walk(el);
      [...el.attributes].forEach((a) => el.removeAttribute(a.name));
      if (!ALLOWED_TAGS.has(el.tagName)) el.replaceWith(...el.childNodes);
    });
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/** مسار بديل بلا DOM (بيئة Node بلا DOMParser، مثل اختبارات الوحدة) — نفس القواعد بمعالجة نصية. */
function sanitizeWithoutDom(html) {
  let out = String(html || "");
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of STRIP_TAGS) {
    const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
    const lone = new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi");
    out = out.replace(paired, "").replace(lone, "");
  }
  out = out.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g, (m, tag) => {
    const closing = m.startsWith("</");
    const T = tag.toUpperCase();
    if (!ALLOWED_TAGS.has(T)) return "";
    return closing ? `</${tag.toLowerCase()}>` : `<${tag.toLowerCase()}>`;
  });
  return out;
}

/** يحوّل وصف سلة الحالي («قبل») إلى HTML آمن للعرض — بلا سكربتات ولا خصائص ولا وسوم خارج القائمة. */
export function safeDescriptionHtml(html) {
  if (typeof DOMParser !== "undefined") return sanitizeWithDom(html);
  return sanitizeWithoutDom(html);
}

const INPUT = "w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-black leading-relaxed focus:outline-none focus:border-slate-400";
const ICON_BTN = "shrink-0 w-9 h-9 rounded-lg border border-slate-200 text-slate-500 hover:text-rose-700 hover:border-rose-300 text-base leading-none";

/** غلاف بطاقة القسم: عنوان وسطر شرح ومفتاح «ينشر» (إلا للوصف: يُنشر دائماً). */
function card(key, title, hint, inner, excluded) {
  const toggle = key
    ? `<label class="shrink-0 whitespace-nowrap inline-flex items-center gap-2 cursor-pointer select-none text-xs font-bold text-slate-600">
        <input type="checkbox" role="switch" class="rm-toggle w-4 h-4 accent-black" data-key="${escHtml(key)}" ${excluded ? "" : "checked"}>
        <span class="rm-toggle-label">${excluded ? "لا ينشر" : "ينشر"}</span>
      </label>`
    : `<span class="shrink-0 whitespace-nowrap text-xs font-bold text-slate-500">ينشر دائماً</span>`;
  return `<section class="rm-card rounded-2xl border border-slate-200 bg-white p-4 space-y-3 transition-opacity${excluded ? " opacity-60" : ""}" data-section="${escHtml(key || "description")}">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 space-y-0.5">
        <h4 class="text-sm font-black text-black">${escHtml(title)}</h4>
        <p class="text-xs text-slate-500 leading-relaxed">${escHtml(hint)}</p>
      </div>
      ${toggle}
    </div>
    ${inner}
  </section>`;
}

function highlightRow(text) {
  return `<div class="rm-hl-row flex items-center gap-2">
    <input type="text" maxlength="200" class="rm-hl ${INPUT}" value="${escHtml(text)}" aria-label="نقطة بيع">
    <button type="button" class="${ICON_BTN}" data-rm-action="remove" aria-label="احذف النقطة">×</button>
  </div>`;
}

function specRow(key, value) {
  return `<div class="rm-spec-row grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-2 items-center">
    <input type="text" maxlength="60" class="rm-spec-key ${INPUT}" value="${escHtml(key)}" placeholder="الخاصية" aria-label="اسم الخاصية">
    <input type="text" maxlength="200" class="rm-spec-val ${INPUT}" value="${escHtml(value)}" placeholder="القيمة" aria-label="قيمة الخاصية">
    <button type="button" class="${ICON_BTN}" data-rm-action="remove" aria-label="احذف الصف">×</button>
  </div>`;
}

function faqRow(q, a) {
  return `<div class="rm-faq-row rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
    <div class="flex items-center gap-2">
      <input type="text" maxlength="200" class="rm-faq-q ${INPUT} font-bold" value="${escHtml(q)}" placeholder="السؤال" aria-label="السؤال">
      <button type="button" class="${ICON_BTN}" data-rm-action="remove" aria-label="احذف السؤال">×</button>
    </div>
    <textarea rows="2" maxlength="600" class="rm-faq-a ${INPUT}" placeholder="الجواب" aria-label="الجواب">${escHtml(a)}</textarea>
  </div>`;
}

/** صف فارغ جديد لقائمة — يُستدعى من زر «أضف». */
export function emptyRow(kind) {
  if (kind === "highlights") return highlightRow("");
  if (kind === "specsTable") return specRow("", "");
  if (kind === "faqs") return faqRow("", "");
  return "";
}

function addButton(kind, label) {
  return `<button type="button" class="sleek-btn-white px-3 py-2 rounded-xl text-xs font-bold" data-rm-action="add" data-kind="${escHtml(kind)}">+ ${escHtml(label)}</button>`;
}

function listCard(kind, title, hint, rows, emptyText, addLabel, excluded) {
  const inner = `<div class="rm-list space-y-2" data-kind="${escHtml(kind)}" data-max="${LIMITS[kind]}">${rows.join("")}</div>
    <p class="rm-list-empty text-xs text-slate-500${rows.length ? " hidden" : ""}">${escHtml(emptyText)}</p>
    ${addButton(kind, addLabel)}`;
  return card(kind, title, hint, inner, excluded);
}

/** معاينة شبيهة بنتيجة جوجل — تتحدّث مع الكتابة (updateSeoPreview). بلا رابط مخترع. */
function seoCard(r, excluded) {
  const title = r.seo?.seoTitle || r.seo?.title || "";
  const meta = r.seo?.metaDescription || "";
  const inner = `<div class="space-y-1.5">
      <div class="flex items-center justify-between gap-2">
        <label for="rmSeoTitle" class="text-xs font-bold text-slate-600">عنوان صفحة المنتج بنتائج البحث</label>
        <span id="rmSeoTitleCount" class="text-xs font-bold text-slate-500 tabular-nums" aria-live="polite"></span>
      </div>
      <input id="rmSeoTitle" type="text" maxlength="70" class="${INPUT}" value="${escHtml(title)}">
    </div>
    <div class="space-y-1.5">
      <div class="flex items-center justify-between gap-2">
        <label for="rmMeta" class="text-xs font-bold text-slate-600">وصف الميتا</label>
        <span id="rmMetaCount" class="text-xs font-bold text-slate-500 tabular-nums" aria-live="polite"></span>
      </div>
      <textarea id="rmMeta" rows="3" maxlength="160" class="${INPUT}">${escHtml(meta)}</textarea>
    </div>
    <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1" aria-label="معاينة تقريبية بنتائج البحث">
      <div class="text-xs text-slate-500">معاينة تقريبية بنتائج البحث</div>
      <div id="rmSnipTitle" class="text-base font-bold text-black leading-snug break-words"></div>
      <div id="rmSnipMeta" class="text-sm text-slate-600 leading-relaxed break-words"></div>
    </div>`;
  return card("seo", "السيو", "كيف يظهر منتجك بجوجل. العنوان المثالي حتى ٦٠ حرفاً، والوصف حتى ١٦٠.", inner, excluded);
}

/** كل أقسام «بعد» لمنتج واحد — HTML مهرَّب بالكامل. */
export function sectionsHtml(r) {
  const ex = r.exclude || {};
  const desc = card(null, "الوصف", "النص الرئيسي بصفحة المنتج — نقاط البيع والأسئلة تُضاف له عند النشر.",
    `<label for="rmDesc" class="sr-only">الوصف الجديد</label>
     <textarea id="rmDesc" rows="9" class="${INPUT}">${escHtml(r.description || "")}</textarea>`, false);
  const excerpt = card("excerpt", "النبذة", "سطر قصير يظهر تحت اسم المنتج.",
    `<label for="rmExcerpt" class="sr-only">النبذة</label>
     <textarea id="rmExcerpt" rows="2" maxlength="250" class="${INPUT}" placeholder="ما كتبت هالة نبذة لهذا المنتج — اكتبها أو أطفئ النشر">${escHtml(r.excerpt || "")}</textarea>`, Boolean(ex.excerpt));
  const highlights = listCard("highlights", "نقاط البيع", "مميزات مختصرة من بيانات منتجك — بلا ادعاءات مخترعة.",
    (r.highlights || []).map(highlightRow), "ما فيه نقاط بيع لهذا المنتج.", "أضف نقطة", Boolean(ex.highlights));
  const specs = listCard("specsTable", "جدول المواصفات", "خصائص المنتج كما وردت ببياناته.",
    (r.specsTable || []).map((s) => specRow(s.key || "", s.value || "")), "ما فيه مواصفات معروفة لهذا المنتج.", "أضف صفاً", Boolean(ex.specsTable));
  const faqs = listCard("faqs", "الأسئلة الشائعة", "أسئلة يسألها عملاؤك غالباً، بأجوبة من بيانات المنتج.",
    (r.faqs || []).map((f) => faqRow(f.q || "", f.a || "")), "ما فيه أسئلة شائعة لهذا المنتج.", "أضف سؤالاً", Boolean(ex.faqs));
  return desc + excerpt + highlights + specs + faqs + seoCard(r, Boolean(ex.seo));
}

/** عدّادات السيو ومعاينة جوجل — تُستدعى بعد الرسم ومع كل كتابة. */
export function updateSeoPreview(root, productName) {
  const t = root.querySelector("#rmSeoTitle");
  const m = root.querySelector("#rmMeta");
  if (!t || !m) return;
  const paint = (el, len, max) => {
    el.innerText = `${len} / ${max}`;
    el.classList.toggle("text-amber-800", len > max);
    el.classList.toggle("text-slate-500", len <= max);
  };
  paint(root.querySelector("#rmSeoTitleCount"), t.value.length, SEO_TITLE_MAX);
  paint(root.querySelector("#rmMetaCount"), m.value.length, META_MAX);
  // innerText لا innerHTML — نص التاجر أو النموذج.
  root.querySelector("#rmSnipTitle").innerText = t.value.trim() || productName || "عنوان المنتج";
  root.querySelector("#rmSnipMeta").innerText = m.value.trim() || "بلا وصف ميتا — جوجل يختار مقتطفاً من الصفحة بنفسه.";
}

/** مفتاح «ينشر» ← نصه وشفافية بطاقته. */
export function syncToggle(box) {
  const on = box.checked;
  const cardEl = box.closest(".rm-card");
  const label = cardEl?.querySelector(".rm-toggle-label");
  if (label) label.innerText = on ? "ينشر" : "لا ينشر";
  cardEl?.classList.toggle("opacity-60", !on);
}

/** قراءة كل الحقول من النموذج بشكل عقد review/decide · update. */
export function collectFields(root) {
  const val = (sel) => (root.querySelector(sel)?.value || "").trim();
  const highlights = [...root.querySelectorAll(".rm-hl")].map((i) => i.value.trim()).filter(Boolean);
  const specsTable = [...root.querySelectorAll(".rm-spec-row")]
    .map((row) => ({ key: row.querySelector(".rm-spec-key").value.trim(), value: row.querySelector(".rm-spec-val").value.trim() }))
    .filter((s) => s.key && s.value);
  const faqs = [...root.querySelectorAll(".rm-faq-row")]
    .map((row) => ({ q: row.querySelector(".rm-faq-q").value.trim(), a: row.querySelector(".rm-faq-a").value.trim() }))
    .filter((f) => f.q && f.a);
  const exclude = {};
  root.querySelectorAll(".rm-toggle").forEach((b) => { exclude[b.dataset.key] = !b.checked; });
  return {
    description: val("#rmDesc"),
    excerpt: val("#rmExcerpt"),
    highlights,
    specsTable,
    faqs,
    seo: { seoTitle: val("#rmSeoTitle"), metaDescription: val("#rmMeta") },
    exclude
  };
}

/** يدمج الحقول المحفوظة بصف العرض المحلي (بلا إعادة رسم أثناء الكتابة). */
export function mergeFields(r, f) {
  r.description = f.description;
  r.excerpt = f.excerpt;
  r.highlights = f.highlights;
  r.specsTable = f.specsTable;
  r.faqs = f.faqs;
  r.seo = { ...(r.seo || {}), ...f.seo };
  r.exclude = { ...(r.exclude || {}), ...f.exclude };
}
