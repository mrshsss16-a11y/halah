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
  return `<details class="text-[11px] text-slate-700 rounded-xl bg-slate-50 border border-slate-200 p-2"><summary class="cursor-pointer font-bold">ما يُنشر مع الوصف (نقاط · مواصفات · أسئلة · سيو)</summary>
    ${hl ? `<ul class="list-disc pr-4 mt-1">${hl}</ul>` : ""}
    ${specs ? `<ul class="pr-4 mt-1">${specs}</ul>` : ""}
    ${faqs ? `<ul class="pr-4 mt-1">${faqs}</ul>` : ""}
    ${meta ? `<div class="mt-1 text-slate-600">${meta}</div>` : ""}</details>`;
}

export function reviewCard(r) {
  const div = document.createElement("div");
  div.className = "rounded-2xl border border-slate-200 bg-white p-4 space-y-2";
  div.dataset.id = r.id;
  const head = `<div class="flex items-start gap-2">
      ${S.reviewState === "pending" ? `<input type="checkbox" class="review-check mt-1" data-id="${r.id}" aria-label="حدّد ${escHtml(r.name || r.sku || "")}">` : ""}
      ${r.imageUrl ? `<img src="${escHtml(r.imageUrl)}" referrerpolicy="no-referrer" class="w-12 h-12 rounded-lg object-cover bg-slate-100" onerror="this.remove()">` : ""}
      <div class="flex-1 min-w-0">
        <div class="text-sm font-black text-black truncate">${escHtml(r.name || r.sku || "")}</div>
        <div class="text-[11px] text-slate-500 font-mono" dir="auto"><bdi>${escHtml(r.sku || "")}</bdi>${r.category ? " · " + "<bdi>" + escHtml(r.category) + "</bdi>" : ""}</div>
      </div>
    </div>`;
  const current = r.currentDescription
    ? `<details class="text-[11px] text-slate-600"><summary class="cursor-pointer font-bold">الوصف الحالي على سلة</summary><div class="mt-1 whitespace-pre-wrap">${escHtml(r.currentDescription)}</div></details>`
    : `<div class="text-[11px] text-slate-500 font-bold">الحالي: بلا وصف</div>`;
  let body = "";
  if (S.reviewState === "pending") {
    // اعتماد/رفض **لكل منتج على حدة**: مع عشرين وصفاً، التأشير ثم الصعود لأعلى
    // الصفحة لكل واحد يقتل التجربة. الأزرار الجماعية أعلى الشاشة باقية كما هي.
    body = `<textarea class="review-desc w-full bg-white border border-slate-300 text-xs rounded-xl p-3 text-black font-medium focus:outline-none focus:border-black" rows="5" data-id="${r.id}">${escHtml(r.description || "")}</textarea>
      ${publishExtras(r)}
      <div class="flex gap-2 items-center flex-wrap">
        <button onclick="decideOne(${r.id}, 'approve')" class="sleek-btn-black px-3 py-1.5 rounded-lg text-[11px]">اعتمد وانشر</button>
        <button onclick="saveReviewEdit(${r.id})" class="sleek-btn-white px-3 py-1.5 rounded-lg text-[11px]">احفظ تعديلي</button>
        <button onclick="decideOne(${r.id}, 'reject')" class="sleek-btn-white px-3 py-1.5 rounded-lg text-[11px] text-rose-700">ارفض</button>
        <span class="review-one-msg text-[11px] font-bold text-slate-600" data-msg="${r.id}"></span>
      </div>`;
  } else {
    body = `<div class="text-xs text-black whitespace-pre-wrap">${escHtml(r.description || "")}</div>`;
    if (S.reviewState === "publish_failed") {
      body += `<div class="text-[11px] text-rose-700 font-bold">${escHtml(r.publishError || "فشل النشر")}</div>
        <button onclick="retryReview(${r.id})" class="sleek-btn-white px-3 py-1.5 rounded-lg text-[11px]">أعد المحاولة</button>`;
    }
    if (S.reviewState === "published") {
      body += `<div class="flex gap-2 items-center"><span class="text-[11px] text-slate-500">نُشر ${escHtml((r.publishedAt || "").slice(0, 16))}</span>
        <button data-revert-sku="${escHtml(r.sku || "")}" onclick="revertReview(this.dataset.revertSku)" class="sleek-btn-white px-3 py-1.5 rounded-lg text-[11px] text-rose-700">تراجع — رجّع الأصل</button></div>`;
    }
    if (S.reviewState === "rejected" && r.reviewNote) body += `<div class="text-[11px] text-slate-500">السبب: ${escHtml(r.reviewNote)}</div>`;
  }
  div.innerHTML = head + current + body;
  return div;
}

export async function loadReview(state) {
  S.reviewState = state || "pending";
  document.querySelectorAll(".review-tab").forEach((b) => {
    const on = b.dataset.state === S.reviewState;
    b.classList.toggle("tab-on", on); b.classList.toggle("tab-off", !on);
  });
  document.getElementById("reviewActions").classList.toggle("hidden", S.reviewState !== "pending");
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
  } catch (e) { loading.classList.add("hidden"); showMsg("reviewFeedback", "تعذر الاتصال.", "error"); }
}

/** زر «تحديث» — كان onclick="loadReview(reviewState)" على متغيّر عام. */
export function reloadReview() {
  return loadReview(S.reviewState);
}

export function selectedReviewIds() {
  return [...document.querySelectorAll(".review-check:checked")].map((c) => Number(c.dataset.id));
}

export function toggleReviewAll(on) {
  document.querySelectorAll(".review-check").forEach((c) => { c.checked = on; });
}

export async function decideReview(action) {
  const payload = { action };
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
  }
  if (action !== "approve_all") {
    payload.ids = selectedReviewIds();
    if (!payload.ids.length) { showMsg("reviewFeedback", "حدّد عنصراً واحداً على الأقل.", "error"); return; }
  }
  try {
    const data = await postReviewDecide(payload);
    if (!data?.ok) { showMsg("reviewFeedback", data?.error || "تعذر التنفيذ.", "error"); return; }
    const n = data.approved ?? data.rejected ?? 0;
    const failedNote = (data.failed || []).length ? ` (${data.failed.length} ما انطبق عليه)` : "";
    showMsg("reviewFeedback", action === "reject"
      ? `رُفض ${n}${failedNote}.`
      : `اعتُمد ${n}${failedNote} — يُنشر على سلة تدريجياً خلال دقائق، تابع تبويب «معتمد بانتظار النشر».`, "success");
    if (action !== "reject") maybeShowFeedback();
    setReviewCounts(data.counts);
    loadReview("pending");
  } catch (e) { showMsg("reviewFeedback", "تعذر الاتصال.", "error"); }
}

/**
 * اعتماد أو رفض **عنصر واحد** — نفس نقطة القرار الجماعية بمعرّف واحد، فلا
 * مسار نشر ثانٍ ولا تجاوز لبوابة المراجعة. التعديل المكتوب بالمربع يُحفظ قبل
 * الاعتماد، وإلا نُشر النص الأصلي بدل ما كتبه التاجر.
 */
export async function decideOne(id, action) {
  const msg = document.querySelector(`[data-msg="${id}"]`);
  const card = document.querySelector(`[data-id="${id}"]`);
  const buttons = card ? card.querySelectorAll("button") : [];
  buttons.forEach((b) => { b.disabled = true; });
  if (msg) msg.innerText = action === "approve" ? "جاري النشر…" : "جاري الرفض…";
  try {
    if (action === "approve") {
      const ta = card?.querySelector(".review-desc");
      if (ta) await postReviewDecide({ action: "edit", ids: [id], description: ta.value });
    }
    const data = await postReviewDecide({ action, ids: [id] });
    if (!data?.ok) {
      if (msg) msg.innerText = data?.error || "تعذر التنفيذ.";
      buttons.forEach((b) => { b.disabled = false; });
      return;
    }
    if (msg) msg.innerText = action === "approve" ? "اعتُمد ✅" : "رُفض";
    setReviewCounts(data.counts);
    setTimeout(() => card?.remove(), 800);
  } catch (e) {
    if (msg) msg.innerText = "تعذر الاتصال.";
    buttons.forEach((b) => { b.disabled = false; });
  }
}

export async function saveReviewEdit(id) {
  const ta = document.querySelector(`.review-desc[data-id="${id}"]`);
  if (!ta) return;
  try {
    const data = await postReviewDecide({ action: "update", id, description: ta.value });
    showMsg("reviewFeedback", data?.ok ? "حُفظ تعديلك — اللي يُنشر هو النص المكتوب هنا بالضبط." : (data?.error || "تعذر الحفظ."), data?.ok ? "success" : "error");
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
