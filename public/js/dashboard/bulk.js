// public/js/dashboard/bulk.js — التوليد بالجملة (B3): توليد من الكتالوج المسحوب ومتابعة تقدّم الوظيفة.
//
// شكوى المالك (2026-09-14): «يقول انه يولد ويختفي التوليد». التقدّم كان شريطاً صغيراً بصفحة «منتجاتي» لا
// يتغيّر لدقائق (المعالجة دفعة كل ~١٠ دقائق)، والجاهز أثناءها يُرسم داخل نافذة «المراجعة والنشر» المخفية —
// فلا أثر مرئي بين البدء والاكتمال. الآن: نافذة «أوصاف منتجاتك» بمرحلة «جاري التجهيز» (عدّادات، قائمة
// المنتجات بحالة كل واحد، «راجع الجاهز الآن» من أول وصف جاهز)، و«أكمل بالخلفية» يصغّرها لشريحة عائمة.
//
// التتبّع بذاكرة الصفحة فقط: لا endpoint يعرض الوظائف الشغّالة لمتجر، وتحديث الصفحة ينهي التتبّع (التوليد
// نفسه مستمر بالخادم، والجاهز يظهر بـ«المراجعة والنشر»). ضغط «ولّد» مرة ثانية أثناء وظيفة شغّالة يرجع
// GENERATE_ALREADY_RUNNING بمعرّفها — فنلتحق بها بدل رسالة خطأ.
import { S } from "./state.js";
import { postBulkStatus, postBulkGenerateAll, postReviewList } from "./api.js";
import { loadReview, setReviewCounts } from "./review.js";
import { showModalShell, syncProgressLinks } from "./reviewModal.js";

const escHtml = window.escHtml;
const showMsg = (id, text, type) => window.showMsg(id, text, type);
const $ = (id) => document.getElementById(id);
const POLL_MS = 15000;
// علامة التأجيل بـdomain/bulk.js · DEFERRED_MARKER («مؤجّل لليوم التالي…») والقديمة («مؤجّل للشهر القادم»).
const DEFERRED_RE = /^مؤج/;

/** نبرة واحدة ظاهرة بشريط «منتجاتي» لكل مسارات التوليد (مفرد، محدد، للكل، ملصوق). */
export function toneValue() {
  return $("pTone")?.value || "white";
}

function freshTracker() {
  return {
    jobId: null, skus: [], meta: new Map(), note: "",
    status: "", total: 0, processed: 0, succeeded: 0, failed: 0, deferred: 0,
    failedBySku: new Map(), ready: new Set(), reviewed: new Set(), pendingCount: 0,
    pollFailures: 0, ticks: 0, lastSucceeded: -1, finished: false
  };
}
const T = freshTracker();

/**
 * يبدأ تتبّع وظيفة توليد ويفتح نافذة التقدّم. `items` = المنتجات المحددة ({sku,name,imageUrl}) إن عُرفت؛
 * «ولّد للكل» بلا قائمة: تظهر المنتجات بالقائمة أول ما يجهز وصفها أو يتعذّر.
 */
export async function pollBulkJob(jobId, { items = [], note = "", openModal = true } = {}) {
  if (S.bulkPollTimer) clearInterval(S.bulkPollTimer);
  document.getElementById("bulkProgress")?.classList.remove("hidden");
  Object.assign(T, freshTracker(), { jobId, note, total: items.length });
  items.forEach((it) => {
    if (!it?.sku) return;
    T.skus.push(it.sku);
    T.meta.set(it.sku, { name: it.name || it.sku, imageUrl: it.imageUrl || "" });
  });
  $("reviewModal").dataset.bulkTracked = "1";
  syncProgressLinks();
  if (openModal) openBulkProgress(); else renderAll();
  await tick();
  if (!T.finished && T.jobId === jobId) S.bulkPollTimer = setInterval(tick, POLL_MS);
}

async function tick() {
  const jobId = T.jobId;
  if (!jobId) return;
  try {
    const { res, data } = await postBulkStatus(jobId);
    if (jobId !== T.jobId) return;
    if (!res.ok || !data?.ok) throw new Error("status failed");
    T.pollFailures = 0;
    T.ticks += 1;
    Object.assign(T, { status: data.status, total: Number(data.total) || T.total, processed: Number(data.processed) || 0, succeeded: Number(data.succeeded) || 0, failed: Number(data.failed) || 0 });
    T.failedBySku = new Map();
    T.deferred = 0;
    // sku/error من بيانات المتجر وردود سلة — تُعرض بـescHtml فقط (SECURITY_AUDIT L5).
    (data.failedItems || []).forEach((i) => {
      const deferred = DEFERRED_RE.test(i.error || "");
      if (deferred) T.deferred += 1;
      T.failedBySku.set(i.sku, { deferred, error: i.error || "" });
      if (!T.meta.has(i.sku)) T.meta.set(i.sku, { name: i.name || i.sku, imageUrl: "" });
    });
    const done = data.status === "done";
    // قائمة الجاهز تُجلب عند تغيّر عدد الجاهز فقط (وكل دقيقة احتياطاً) — لا نداءً مع كل نبضة بلا داعٍ.
    if (done || T.succeeded !== T.lastSucceeded || T.ticks % 4 === 1) {
      T.lastSucceeded = T.succeeded;
      await refreshReady();
    }
    if (done) finishTracking();
  } catch (e) {
    T.pollFailures += 1;
  }
  renderAll();
}

async function refreshReady() {
  try {
    const { data } = await postReviewList("pending", 100);
    if (!data?.ok) return;
    const rows = data.rows || data.items || [];
    T.pendingCount = Number(data.counts?.pending ?? rows.length);
    if (data.counts) setReviewCounts(data.counts);
    T.ready = new Set();
    rows.forEach((r) => {
      if (!r.sku) return;
      T.ready.add(r.sku);
      const known = T.meta.get(r.sku);
      if (!T.skus.length || known) T.meta.set(r.sku, { name: known?.name || r.name || r.sku, imageUrl: known?.imageUrl || r.imageUrl || "" });
    });
  } catch (e) { /* النبضة التالية تعيد المحاولة */ }
}

function finishTracking() {
  if (T.finished) return;
  T.finished = true;
  clearInterval(S.bulkPollTimer);
  S.bulkPollTimer = null;
  const btn = $("bulkGenerateBtn");
  if (btn) btn.disabled = false;
  // لا «باقي قيد الكتابة» بعد الاكتمال: «تابع التجهيز» بالمراجعة يختفي، والشريحة/الشريط يبقيان للملخص.
  $("reviewModal").dataset.bulkTracked = "";
  syncProgressLinks();
  loadReview("pending");
  // وعد الرسالة عند البدء: «تُفتح لك النافذة لما تجهز» — فقط إن كانت مغلقة (لا نقاطع مراجعة جارية).
  if (T.pendingCount > 0 && $("reviewModal")?.classList.contains("hidden")) openBulkProgress();
}

/** يفتح نافذة «أوصاف منتجاتك» على مرحلة التقدّم — من الشريحة العائمة أو الشريط أو «تابع التجهيز». */
export function openBulkProgress() {
  if (!T.jobId) return;
  showModalShell("progress");
  renderAll();
}

const counts = () => ({
  ready: T.succeeded,
  writing: Math.max(0, T.total - T.processed),
  deferred: T.deferred,
  failed: Math.max(0, T.failed - T.deferred)
});

const BADGE = {
  ready: "bg-emerald-50 text-emerald-800",
  writing: "bg-slate-100 text-slate-600",
  failed: "bg-rose-50 text-rose-700",
  deferred: "bg-amber-50 text-amber-800",
  reviewed: "bg-slate-100 text-slate-500",
  done: "bg-slate-100 text-slate-600"
};

function itemStatus(sku) {
  if (T.reviewed.has(sku)) return { k: "reviewed", label: "تمت مراجعته" };
  if (T.ready.has(sku)) return { k: "ready", label: "جاهز للمراجعة" };
  const f = T.failedBySku.get(sku);
  if (f) return f.deferred ? { k: "deferred", label: "مؤجَّل — حد اليوم", note: "يُكمَل تلقائياً مع تجدّد حد الأوصاف" } : { k: "failed", label: "تعذّر", note: f.error };
  if (T.finished) return { k: "done", label: "اكتمل" };
  return { k: "writing", label: "قيد الكتابة" };
}

function itemRowHtml(sku) {
  const m = T.meta.get(sku) || { name: sku, imageUrl: "" };
  const st = itemStatus(sku);
  const img = m.imageUrl ? `<img src="${escHtml(m.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" class="w-full h-full object-contain" onerror="this.remove()">` : "";
  const dot = st.k === "writing" ? '<span class="w-1.5 h-1.5 rounded-full bg-slate-400 motion-safe:animate-pulse" aria-hidden="true"></span>' : "";
  return `<li class="flex items-center gap-3 py-2.5 border-b border-slate-200 last:border-b-0">
    <span class="shrink-0 w-11 h-11 rounded-xl bg-slate-50 border border-slate-200 overflow-hidden flex items-center justify-center">${img}</span>
    <span class="flex-1 min-w-0">
      <span class="block text-sm font-bold text-black truncate">${escHtml(m.name)}</span>
      ${st.note ? `<span class="block text-xs text-slate-500 truncate">${escHtml(st.note)}</span>` : ""}
    </span>
    <span class="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${BADGE[st.k]}">${dot}${escHtml(st.label)}</span>
  </li>`;
}

function itemsHtml() {
  const skus = T.skus.length ? T.skus : [...T.meta.keys()];
  const c = counts();
  const rows = skus.map(itemRowHtml);
  if (!T.skus.length && c.writing > 0) {
    rows.push(`<li class="py-3 text-sm text-slate-500">${c.writing} منتج قيد الكتابة — يظهر هنا أول ما يجهز وصفه.</li>`);
  }
  return rows.length ? rows.join("") : '<li class="py-8 text-center text-sm text-slate-500">جاري جلب حالة التوليد…</li>';
}

function etaText() {
  // المؤجَّل له سطر ظاهر مستقل (#rmStatDeferredWrap) — لا يتكرر هنا.
  if (T.finished) {
    return counts().ready ? "اكتمل التجهيز — راجع الأوصاف واعتمد اللي يعجبك. ما يُنشر شيء على سلة قبل اعتمادك." : "انتهت الوظيفة بلا أوصاف جاهزة.";
  }
  return "هالة تكتب على دفعات كل ~١٠ دقائق، فالأوصاف تجهز على مراحل لا مرة واحدة. تقدر تكمل شغلك: التوليد مستمر عندنا حتى لو أغلقت الصفحة، وما دامت هذي الصفحة مفتوحة نرجّع لك النافذة لما يكتمل.";
}

function renderProgressView() {
  if (!$("rmProgressView")) return;
  const c = counts();
  const pct = T.total ? Math.round((T.processed / T.total) * 100) : 0;
  $("rmProgHeadline").innerText = T.finished
    ? "اكتمل التجهيز"
    : T.processed ? `هالة تكتب أوصاف منتجاتك — ${T.processed} من ${T.total}` : "هالة بدأت تجهّز أوصاف منتجاتك";
  const bar = $("rmProgBar");
  bar.style.width = pct + "%";
  bar.parentElement.setAttribute("aria-valuenow", String(pct));
  $("rmProgPct").innerText = pct + "٪";
  $("rmStatReady").innerText = String(c.ready);
  $("rmStatWriting").innerText = String(c.writing);
  $("rmStatFailed").innerText = String(c.failed);
  $("rmStatDeferred").innerText = String(c.deferred);
  $("rmStatDeferredWrap").classList.toggle("hidden", !c.deferred);
  $("rmProgNote").innerText = T.note || "";
  $("rmProgNote").classList.toggle("hidden", !T.note);
  $("rmEta").innerText = etaText();
  $("rmItems").innerHTML = itemsHtml();
  $("rmProgMsg").innerText = T.pollFailures >= 3
    ? "توقّف تتبّع التقدّم مؤقتاً بسبب مشكلة اتصال — عملك لسه شغّال بالخلفية، والجاهز يظهر بزر «المراجعة والنشر»."
    : "";
  const reviewBtn = $("rmReviewReady");
  reviewBtn.disabled = T.pendingCount < 1;
  $("rmReviewReadyText").innerText = T.finished ? "ابدأ المراجعة" : "راجع الجاهز الآن";
  $("rmReviewReadyCount").innerText = String(T.pendingCount);
  $("rmBackground").innerText = T.finished ? "إغلاق" : "أكمل بالخلفية";
}

function renderInline() {
  const box = $("bulkProgress");
  if (!box || !T.jobId) return;
  const c = counts();
  const pct = T.total ? Math.round((T.processed / T.total) * 100) : 0;
  $("bulkProgressBar").style.width = pct + "%";
  $("bulkProgressCount").innerText = `${T.processed} / ${T.total}`;
  $("bulkProgressLabel").innerText = T.pollFailures >= 3
    ? "توقّف تتبّع التقدّم مؤقتاً بسبب مشكلة اتصال — عملك لسه شغّال بالخلفية، افتح «المراجعة والنشر» واضغط «تحديث» لمتابعته."
    : T.finished
      ? `اكتمل: ${c.ready} جاهز للمراجعة، ${c.failed + c.deferred} تعذّر أو مؤجَّل`
      : `جاري تجهيز الأوصاف: ${c.ready} جاهز · ${c.writing} قيد الكتابة`;
}

function renderChip() {
  const chip = $("bulkChip");
  if (!chip) return;
  const modalHidden = $("reviewModal")?.classList.contains("hidden") !== false;
  const show = Boolean(T.jobId) && modalHidden && (!T.finished || T.pendingCount > 0);
  chip.classList.toggle("hidden", !show);
  if (!show) return;
  const pct = T.total ? Math.round((T.processed / T.total) * 100) : 0;
  $("bulkChipBar").style.width = (T.finished ? 100 : pct) + "%";
  $("bulkChipText").innerText = T.finished
    ? `جاهز للمراجعة (${T.pendingCount})`
    : `جاري التجهيز — ${T.succeeded} جاهز من ${T.total || "…"}`;
}

function renderAll() {
  renderProgressView();
  renderInline();
  renderChip();
}

document.addEventListener("hala:review-decided", (e) => {
  const sku = e.detail?.sku;
  if (!sku) return;
  T.reviewed.add(sku);
  T.ready.delete(sku);
  T.pendingCount = Math.max(0, T.pendingCount - 1);
  renderAll();
});
document.addEventListener("hala:review-modal-closed", renderChip);
document.addEventListener("hala:show-progress", openBulkProgress);

// ── «ولّد لكل منتجاتي» ─────────────────────────────────────
export async function startCatalogGenerate() {
  const btn = $("bulkGenerateBtn");
  btn.disabled = true;
  $("bulkFeedback").classList.add("hidden");
  try {
    const { data } = await postBulkGenerateAll(toneValue());
    if (data?.code === "GENERATE_ALREADY_RUNNING" && data.jobId) {
      showMsg("bulkFeedback", data.error, "info");
      pollBulkJob(data.jobId, { note: data.error });
      btn.disabled = false;
      return;
    }
    if (!data?.ok) { showMsg("bulkFeedback", data?.error || "تعذر بدء التوليد.", "error"); btn.disabled = false; return; }
    // upgradeHint («رقّي الباقة») لا يُعرض: لا مسار ترقية باللوحة، فهو وعد بلا زر.
    showMsg("bulkFeedback", data.message + ` — تبدأ المعالجة خلال ~١٠ دقائق (كل ١٠ دقائق دفعة، تقدير الإكمال: ~${data.etaMinutes} دقيقة).`, "info");
    pollBulkJob(data.jobId, { note: data.message });
  } catch (e) { showMsg("bulkFeedback", "تعذر الاتصال.", "error"); }
  btn.disabled = false;
}
