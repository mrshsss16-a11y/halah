// public/js/dashboard/review.js — طابور المراجعة البشرية (الـAI يقترح، التاجر
// يقرر) + بطاقة التغذية الراجعة. لا شيء يُنشر على سلة قبل قرار التاجر.
import { S } from "./state.js";
import { confirmAction } from "./embedded.js";
import { postReviewList, postReviewDecide, postFeedback } from "./api.js";

const escHtml = window.escHtml;
const showMsg = (id, text, type) => window.showMsg(id, text, type);

// حالة فارغة لكل تبويب بدل «لا شيء هنا» واحدة لخمس حالات مختلفة.
const REVIEW_EMPTY = {
  pending: "ما فيه أوصاف بانتظار مراجعتك. حدّد منتجات من «منتجاتي» واضغط «ولّد أوصاف المحدد».",
  awaiting_publish: "ما فيه أوصاف معتمدة تنتظر النشر.",
  published: "ما نُشر شيء على سلة بعد.",
  publish_failed: "ما فيه نشر فاشل.",
  rejected: "ما رفضت أي وصف."
};

export function setReviewCounts(c) {
  if (!c) return;
  document.getElementById("rvPending").innerText = c.pending;
  document.getElementById("rvAwaiting").innerText = c.awaitingPublish;
  document.getElementById("rvPublished").innerText = c.published;
  document.getElementById("rvFailed").innerText = c.publishFailed;
  document.getElementById("rvRejected").innerText = c.rejected;
  // عدّاد زر «المراجعة والنشر» بشريط «منتجاتي»: ما ينتظر قرار التاجر.
  const badge = document.getElementById("rvBadge");
  if (badge) { badge.innerText = c.pending; badge.classList.toggle("hidden", !c.pending); }
  // زر نافذة «قبل وبعد» يظهر فقط حين يوجد ما يُراجَع.
  const modalBtn = document.getElementById("reviewModalBtn");
  if (modalBtn) { modalBtn.classList.toggle("hidden", !c.pending); document.getElementById("rvModalCount").innerText = c.pending; }
  const parts = [];
  if (c.pending) parts.push(`${c.pending} بانتظار قرارك`);
  if (c.awaitingPublish) parts.push(`${c.awaitingPublish} معتمد يُنشر خلال دقائق (بحدود سلة: ~٢٠ كل ١٠ دقائق)`);
  if (c.publishFailed) parts.push(`${c.publishFailed} فشل نشره`);
  document.getElementById("reviewCountsLine").innerText = parts.length ? parts.join(" · ") : "كل وصف مولَّد بالجملة يمرّ من هنا. ما يُنشر على سلة إلا ما تعتمده.";
}

// ما يُنشر فعلاً مع الوصف على سلة (نفس البناء بـservices/sallaProductPayload.js):
// النقاط والأسئلة داخل وصف الصفحة، والعنوان/الميتا بحقول السيو، والنبذة تحت الاسم.
export function publishExtras(r) {
  const hl = (r.highlights || []).map((h) => `<li>${escHtml(h)}</li>`).join("");
  const faqs = (r.faqs || []).map((f) => `<li><b>${escHtml(f.q || "")}</b> — ${escHtml(f.a || "")}</li>`).join("");
  const specs = (r.specsTable || []).map((x) => `<li>${escHtml(x.key || "")}: ${escHtml(x.value || "")}</li>`).join("");
  const meta = [
    r.seo?.seoTitle || r.seo?.title ? `عنوان البحث: ${escHtml(r.seo.seoTitle || r.seo.title)}` : "",
    r.seo?.metaDescription ? `وصف البحث: ${escHtml(r.seo.metaDescription)}` : "",
    r.excerpt ? `تحت اسم المنتج: ${escHtml(r.excerpt)}` : ""
  ].filter(Boolean).join("<br>");
  if (!hl && !faqs && !meta && !specs) return "";
  return `<details class="text-[13px] text-slate-700 rounded-xl bg-slate-50 border border-slate-200 p-2"><summary class="cursor-pointer font-bold">ما يُنشر مع الوصف (نقاط · مواصفات · أسئلة · سيو)</summary>
    ${hl ? `<ul class="list-disc pr-4 mt-1">${hl}</ul>` : ""}
    ${specs ? `<ul class="pr-4 mt-1">${specs}</ul>` : ""}
    ${faqs ? `<ul class="pr-4 mt-1">${faqs}</ul>` : ""}
    ${meta ? `<div class="mt-1 text-slate-600">${meta}</div>` : ""}</details>`;
}

// شارة الحالة بأعلى كل صف — عنوان الحالة نفسها التي فتح التاجر تبويبها، فلا
// حاجة لقراءة كل بطاقة لمعرفة أين هي بالطابور.
const REVIEW_STATE_CHIP = {
  pending: "بانتظار المراجعة",
  awaiting_publish: "معتمد",
  published: "منشور",
  publish_failed: "فشل النشر",
  rejected: "مرفوض"
};

/**
 * صف مضغوط (طلب المالك 2026-09-17: «العناصر مضغوطة والأزرار كثيرة» — كانت كل
 * بطاقة تحمل مربّع نص + ٤ أزرار). الصورة والاسم والـSKU وشارة الحالة وزر واحد
 * فقط «راجع» يفتح نافذة «أوصاف منتجاتك» (reviewModal.js) بكل الحقول — لا تعديل
 * ولا اعتماد هنا. النقر على الصف كله يفتح نفس النافذة.
 */
export function reviewCard(r) {
  const div = document.createElement("div");
  const name = escHtml(r.name || r.sku || "منتج بلا اسم");
  div.className = "review-row flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 cursor-pointer hover:bg-slate-50 transition";
  div.dataset.id = r.id;
  div.setAttribute("role", "button");
  div.tabIndex = 0;
  div.setAttribute("aria-label", `راجع ${name}`);
  div.onclick = () => window.openReviewModal(r.id);
  div.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); window.openReviewModal(r.id); } };

  let actionBtn = "";
  if (S.reviewState === "published") {
    actionBtn = `<button type="button" data-revert-sku="${escHtml(r.sku || "")}" onclick="event.stopPropagation(); revertReview(this.dataset.revertSku)" class="sleek-btn-white px-3 py-1.5 rounded-lg text-[13px] text-rose-700 shrink-0">تراجع</button>`;
  } else if (S.reviewState === "publish_failed") {
    actionBtn = `<button type="button" onclick="event.stopPropagation(); retryReview(${r.id})" class="sleek-btn-white px-3 py-1.5 rounded-lg text-[13px] shrink-0">أعد المحاولة</button>`;
  } else if (S.reviewState === "pending") {
    actionBtn = `<button type="button" onclick="event.stopPropagation(); openReviewModal(${r.id})" class="sleek-btn-white px-3 py-1.5 rounded-lg text-[13px] shrink-0">راجع</button>`;
  }
  // معتمد (awaiting_publish) ومرفوض بلا إجراء سطري — النقر على الصف يفتح النافذة للاطلاع فقط.

  div.innerHTML = `
    ${r.imageUrl ? `<img src="${escHtml(r.imageUrl)}" referrerpolicy="no-referrer" class="w-10 h-10 rounded-lg object-contain bg-slate-50 border border-slate-200 shrink-0" onerror="this.remove()">` : `<span class="w-10 h-10 rounded-lg bg-slate-50 border border-slate-200 shrink-0"></span>`}
    <div class="flex-1 min-w-0">
      <div class="text-[13px] font-black text-black truncate">${name}</div>
      <div class="meta-12 text-xs text-slate-500 font-mono truncate" dir="auto"><bdi>${escHtml(r.sku || "")}</bdi>${r.category ? " · <bdi>" + escHtml(r.category) + "</bdi>" : ""}</div>
    </div>
    <span class="text-[11px] font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-600 shrink-0">${REVIEW_STATE_CHIP[S.reviewState] || ""}</span>
    ${actionBtn}`;
  return div;
}

export async function loadReview(state) {
  S.reviewState = state || "pending";
  document.querySelectorAll(".review-tab").forEach((b) => {
    const on = b.dataset.state === S.reviewState;
    b.classList.toggle("tab-on", on); b.classList.toggle("tab-off", !on);
  });
  const list = document.getElementById("reviewList");
  const loading = document.getElementById("reviewLoading");
  const empty = document.getElementById("reviewEmpty");
  list.innerHTML = ""; empty.classList.add("hidden"); loading.classList.remove("hidden");
  document.getElementById("reviewFeedback").classList.add("hidden");
  try {
    const { data } = await postReviewList(S.reviewState, 100);
    loading.classList.add("hidden");
    if (!data?.ok) { showMsg("reviewFeedback", data?.error || "تعذر التحميل.", "error"); return; }
    setReviewCounts(data.counts);
    S.reviewRows = data.rows || [];
    if (!S.reviewRows.length) { empty.innerText = REVIEW_EMPTY[S.reviewState] || REVIEW_EMPTY.pending; empty.classList.remove("hidden"); return; }
    S.reviewRows.forEach((r) => list.appendChild(reviewCard(r)));
  } catch (e) {
    // «تعذر الاتصال.» وحدها أخفت سبب فشل حقيقي (2026-09-13) — السبب بوحدة التحكم، والرسالة تقول ما يفعله التاجر.
    console.error("[review] load failed", e);
    loading.classList.add("hidden");
    showMsg("reviewFeedback", "تعذر تحميل قائمة المراجعة — تأكد من الإنترنت ثم اضغط «تحديث».", "error");
  }
}

/** نافذة «المراجعة والنشر» — كل حالات الطابور (بانتظارك، معتمد، نُشر مع التراجع، فشل، مرفوض) بمكان واحد. */
export function openReviewPanel(state) {
  const panel = document.getElementById("reviewPanel");
  if (!panel) return;
  panel.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  loadReview(state || S.reviewState || "pending");
}

export function closeReviewPanel() {
  document.getElementById("reviewPanel")?.classList.add("hidden");
  if (document.getElementById("reviewModal")?.classList.contains("hidden") !== false) document.body.style.overflow = "";
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || document.getElementById("reviewPanel")?.classList.contains("hidden") !== false) return;
  // نافذة «قبل وبعد» فوقها تُغلق أولاً (reviewModal.js).
  if (document.getElementById("reviewModal")?.classList.contains("hidden") === false) return;
  closeReviewPanel();
});

/** زر «تحديث» — كان onclick="loadReview(reviewState)" على متغيّر عام. */
export function reloadReview() {
  return loadReview(S.reviewState);
}

// بعد أي قرار أو إغلاق بنافذة «أوصاف منتجاتك» (reviewModal.js) — القائمة المضغوطة
// خلفها تحدّث نفسها، فلا يرى التاجر منتجاً قرر بشأنه للتو لا يزال بالقائمة.
document.addEventListener("hala:review-decided", () => {
  if (!document.getElementById("reviewPanel")?.classList.contains("hidden")) loadReview(S.reviewState);
});
document.addEventListener("hala:review-modal-closed", () => {
  if (!document.getElementById("reviewPanel")?.classList.contains("hidden")) loadReview(S.reviewState);
});

/**
 * إعادة تصميم 2026-09-17 (طلب المالك): الاعتماد/الرفض الفردي والجماعي المحدَّد
 * صارا حصراً داخل نافذة «أوصاف منتجاتك» (reviewModal.js: reviewModalDecide /
 * reviewModalApproveAll) — القائمة هنا للتصفّح والفتح فقط. «اعتمد الكل وانشره»
 * وحده بقي هنا (بقائمة ⋯ برأس النافذة) لأنه لا يفتح على منتج بعينه.
 */
export async function decideReview(action) {
  if (action === "approve_all") {
    // «اعتمد الكل» ينشر كل الطابور على متجر حي — لا يمر بضغطة عابرة.
    const n = Number(document.getElementById("rvPending")?.innerText || 0);
    const confirmed = await confirmAction({
      title: "اعتماد كل الأوصاف",
      message: `نعتمد ${n || "كل"} وصف بانتظار مراجعتك وننشرها على متجرك بسلة تدريجياً؟ تقدر تتراجع عن أي منتج بعد النشر.`,
      confirmText: "اعتمد وانشر الكل",
      cancelText: "إلغاء",
      variant: "warning"
    });
    if (!confirmed) return;
  } else {
    return;
  }
  try {
    const data = await postReviewDecide({ action: "approve_all" });
    if (!data?.ok) { showMsg("reviewFeedback", data?.error || "تعذر التنفيذ.", "error"); return; }
    const n2 = data.approved ?? 0;
    showMsg("reviewFeedback", `اعتُمد ${n2} — يُنشر على سلة تدريجياً خلال دقائق، تابع تبويب «معتمد بانتظار النشر».`, "success");
    maybeShowFeedback();
    setReviewCounts(data.counts);
    loadReview("pending");
  } catch (e) { showMsg("reviewFeedback", "تعذر الاتصال.", "error"); }
}

export async function retryReview(id) {
  try {
    const data = await postReviewDecide({ action: "retry", id });
    showMsg("reviewFeedback", data?.ok ? data.message : (data?.error || "تعذر."), data?.ok ? "success" : "error");
    loadReview("publish_failed");
  } catch (e) { showMsg("reviewFeedback", "تعذر الاتصال.", "error"); }
}

export async function revertReview(sku) {
  const confirmed = await confirmAction({
    title: "التراجع عن الوصف",
    message: "نرجّع الوصف الأصلي لهذا المنتج على سلة؟",
    confirmText: "رجّع الأصلي",
    cancelText: "إلغاء",
    variant: "warning"
  });
  if (!confirmed) return;
  try {
    const data = await postReviewDecide({ action: "revert", sku });
    // كانت "error" دائماً — تراجع ناجح يظهر أحمر فيظنه التاجر فشلاً.
    showMsg("reviewFeedback", data?.ok ? data.message : (data?.error || "تعذر التراجع."), data?.ok ? "success" : "error");
    loadReview("published");
  } catch (e) { showMsg("reviewFeedback", "تعذر الاتصال.", "error"); }
}

// ── تغذية راجعة (المرحلة ٤) ────────────────────────────────
// تُعرض مرة واحدة بعد أول تفاعل حقيقي (توليد/نشر/اعتماد) — لا تزعج بالدخول الأول.
const FB_KEY = "hala_feedback_done";

export function feedbackDone() {
  try { return localStorage.getItem(FB_KEY) === "1"; } catch (e) { return false; }
}

export function maybeShowFeedback() {
  if (feedbackDone()) return;
  let n = 0;
  try { n = Number(localStorage.getItem("hala_actions") || 0) + 1; localStorage.setItem("hala_actions", String(n)); } catch (e) { n = 2; }
  if (n >= 2) document.getElementById("feedbackCard").classList.remove("hidden");
}

export function dismissFeedback() {
  document.getElementById("feedbackCard").classList.add("hidden");
  try { localStorage.setItem(FB_KEY, "1"); } catch (e) {}
}

export function pickFeedbackScore(n) {
  S.feedbackScore = n;
  document.querySelectorAll(".fb-star").forEach((b) => {
    const on = Number(b.dataset.score) === n;
    b.className = "fb-star " + (on ? "sleek-btn-black" : "sleek-btn-white") + " w-10 h-10 rounded-xl text-sm font-black";
  });
  document.getElementById("feedbackSendBtn").disabled = false;
}

export async function sendFeedback() {
  if (!S.feedbackScore) return;
  const btn = document.getElementById("feedbackSendBtn"); btn.disabled = true;
  try {
    const { data } = await postFeedback(S.feedbackScore, document.getElementById("feedbackComment").value, "studio");
    document.getElementById("feedbackMsg").innerText = data?.ok ? (data.message || "شكراً!") : (data?.error || "تعذر الإرسال.");
    if (data?.ok) { try { localStorage.setItem(FB_KEY, "1"); } catch (e) {} setTimeout(() => document.getElementById("feedbackCard").classList.add("hidden"), 1500); }
    else btn.disabled = false;
  } catch (e) { document.getElementById("feedbackMsg").innerText = "تعذر الاتصال."; btn.disabled = false; }
}
