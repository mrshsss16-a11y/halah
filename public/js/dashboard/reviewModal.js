// public/js/dashboard/reviewModal.js — نافذة «أوصاف منتجاتك» (طلب المالك 2026-09-14): مرحلتان بنافذة واحدة.
//   «جاري التجهيز» — تقدّم التوليد الجماعي (يرسمها bulk.js داخل #rmProgressView).
//   «مراجعة» — منتج منتج: «قبل» الوصف الحالي على سلة، و«بعد» كل حقل يُنشر (reviewSections.js) قابلاً للتعديل
//   مع مفتاح «ينشر» لكل قسم؛ ثم رفض · تخطي · «اعتمد وانشر ← التالي»، و«اعتمد الكل وانشر» بتأكيد.
// نفس نقطة القرار (review/decide) — لا مسار نشر ثانٍ يتجاوز بوابة المراجعة. التعديل يُحفظ تلقائياً بعد توقف
// الكتابة، وإلزامياً قبل أي انتقال أو اعتماد أو إغلاق (وإلا نُشر النص الأصلي بدل ما كتبه التاجر).
//
// لا استيراد من bulk.js (يستوردنا هو): التواصل بأحداث document — hala:review-decided · hala:review-modal-closed
// · hala:show-progress · hala:review-ready (جهز وصف جديد). و#reviewModal[data-bulk-tracked="1"] يعني أن توليداً مُتتبَّعاً بهذه الصفحة.
import { confirmAction } from "./embedded.js";
import { postReviewList, postReviewDecide } from "./api.js";
import { setReviewCounts, loadReview, maybeShowFeedback } from "./review.js";
import { sectionsHtml, safeDescriptionHtml, updateSeoPreview, syncToggle, collectFields, mergeFields, emptyRow } from "./reviewSections.js";

const escHtml = window.escHtml;
const $ = (id) => document.getElementById(id);
const M = { phase: "review", rows: [], index: 0, pendingTotal: 0, busy: false, dirty: false, saveTimer: null, saveChain: Promise.resolve(true), lastFocus: null, loading: false, decided: new Set() };
const SAVE_IDLE_MS = 1500;
const MSG_TONE = { error: "text-rose-700", success: "text-emerald-800", info: "text-slate-600" };

const modalOpen = () => $("reviewModal")?.classList.contains("hidden") === false;
const bulkTracked = () => $("reviewModal")?.dataset.bulkTracked === "1";

function setMsg(text, tone = "info") {
  const el = $("rmMsg");
  if (!el) return;
  el.innerText = text || "";
  el.className = "text-sm font-bold " + (MSG_TONE[tone] || MSG_TONE.info);
}

function setSaveState(text) {
  const el = $("rmSaveState");
  if (el) el.innerText = text || "";
}

/** يفتح النافذة (إن كانت مغلقة) على مرحلة — يستدعيها bulk.js للتقدّم وopenReviewModal للمراجعة. */
export function showModalShell(phase) {
  const modal = $("reviewModal");
  if (!modal) return false;
  const wasHidden = modal.classList.contains("hidden");
  if (wasHidden) {
    M.lastFocus = document.activeElement;
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
  M.phase = phase;
  if (phase === "review") startLive(); else stopLive();
  $("rmProgressView").classList.toggle("hidden", phase !== "progress");
  $("rmReviewView").classList.toggle("hidden", phase !== "review");
  $("rmSub").innerText = phase === "progress" ? "جاري التجهيز — تقدر تكمل شغلك والتوليد مستمر" : "مراجعة منتج منتج — ما يُنشر شيء قبل اعتمادك";
  syncProgressLinks();
  if (wasHidden) $("rmTitle")?.focus();
  return wasHidden;
}

/** «تابع تجهيز الباقي» يظهر فقط حين يوجد توليد متتبَّع بهذه الصفحة. */
export function syncProgressLinks() {
  const on = bulkTracked();
  $("rmToProgress")?.classList.toggle("hidden", !on);
}

export async function openReviewModal(startId) {
  if (!$("reviewModal")) return;
  if (modalOpen() && M.phase === "review" && !(await saveNow())) return;
  showModalShell("review");
  await loadRows(startId);
}

async function loadRows(startId) {
  M.rows = [];
  M.index = 0;
  M.dirty = false;
  M.loading = true;
  $("rmStepHead").classList.add("hidden");
  $("rmActions").classList.add("hidden");
  $("rmBody").innerHTML = '<div role="status" class="py-16 text-center text-sm text-slate-500">جاري تحميل الأوصاف الجاهزة…</div>';
  try {
    const { data } = await postReviewList("pending", 100);
    if (!data?.ok) throw new Error(data?.error || "review list failed");
    M.rows = data.rows || data.items || [];
    M.pendingTotal = Number(data.counts?.pending ?? M.rows.length);
    if (data.counts) setReviewCounts(data.counts);
    const at = M.rows.findIndex((r) => r.id === Number(startId));
    M.index = at >= 0 ? at : 0;
    M.loading = false;
    renderStep();
  } catch (e) {
    M.loading = false;
    console.error("[review-modal] load failed", e);
    $("rmBody").innerHTML = `<div class="py-16 text-center space-y-3">
      <p class="text-base font-black text-black">ما قدرنا نحمّل الأوصاف</p>
      <p class="text-sm text-slate-600">تأكد من اتصالك بالإنترنت ثم أعد المحاولة. أوصافك محفوظة عندنا ولا ضاع منها شيء.</p>
      <button type="button" data-rm-action="reload" class="sleek-btn-white px-4 py-2.5 rounded-xl text-sm font-bold">أعد المحاولة</button>
    </div>`;
  }
}

function emptyStateHtml() {
  const more = bulkTracked()
    ? '<p class="text-sm text-slate-600">باقي منتجات قيد الكتابة الحين — تظهر هنا تلقائياً أول ما تجهز.</p><button type="button" data-rm-action="to-progress" class="sleek-btn-white px-4 py-2.5 rounded-xl text-sm font-bold">تابع التجهيز</button>'
    : "";
  return `<div class="py-16 text-center space-y-3 max-w-md mx-auto">
    <p class="text-base font-black text-black">ما فيه أوصاف تنتظر مراجعتك الحين</p>
    <p class="text-sm text-slate-600 leading-relaxed">المعتمد يُنشر على سلة تدريجياً خلال دقائق، وتقدر تتراجع عن أي منتج بعد نشره من «المراجعة والنشر».</p>
    ${more}
  </div>`;
}

function productHeadHtml(r) {
  const img = r.imageUrl
    ? `<img src="${escHtml(r.imageUrl)}" alt="" referrerpolicy="no-referrer" class="w-full h-full object-contain" onerror="this.remove()">`
    : "";
  return `<span class="rm-thumb shrink-0 w-14 h-14 rounded-xl bg-slate-50 border border-slate-200 overflow-hidden flex items-center justify-center">${img}</span>
    <span class="min-w-0">
      <span class="block text-base font-black text-black truncate">${escHtml(r.name || r.sku || "منتج بلا اسم")}</span>
      <span class="rm-sub-line block text-xs meta-12 text-slate-500 truncate" dir="auto"><bdi>${escHtml(r.sku || "")}</bdi>${r.category ? " · <bdi>" + escHtml(r.category) + "</bdi>" : ""}</span>
    </span>`;
}

function beforeHtml(r) {
  const safe = safeDescriptionHtml(r.currentDescription);
  const wide = window.matchMedia?.("(min-width: 768px)").matches;
  return `<details class="rm-before rounded-2xl border border-slate-200 bg-slate-50 p-4"${wide ? " open" : ""}><summary class="cursor-pointer text-sm font-bold text-slate-600">قبل — الوصف الحالي على سلة</summary><div class="rm-before-body mt-3 text-sm text-slate-600 leading-relaxed">${safe || "بلا وصف حالي"}</div></details>`;
}

function renderStep() {
  const total = M.rows.length;
  const body = $("rmBody");
  M.dirty = false;
  setMsg("");
  setSaveState("");
  $("rmStepHead").classList.toggle("hidden", !total);
  $("rmActions").classList.toggle("hidden", !total);
  if (!total) {
    body.innerHTML = emptyStateHtml();
    return;
  }
  const r = M.rows[M.index];
  $("rmCounter").innerText = `${M.index + 1} من ${total}`;
  $("rmStepBar").style.width = Math.round(((M.index + 1) / total) * 100) + "%";
  $("rmProductHead").innerHTML = productHeadHtml(r);
  $("rmPrev").disabled = M.index === 0;
  $("rmNext").disabled = M.index >= total - 1;
  $("rmApproveAllCount").innerText = String(Math.max(M.pendingTotal, total));
  body.innerHTML = `<div class="cq-box"><div class="rm-grid2 grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 items-start">
      <aside class="min-w-0 md:sticky md:top-0">${beforeHtml(r)}</aside>
      <div class="min-w-0 space-y-3">
        <h3 class="text-sm font-black text-black">بعد — صفحة المنتج الجديدة</h3>
        ${sectionsHtml(r)}
      </div>
    </div></div>`;
  updateSeoPreview(body, r.name);
  // 2026-09-17: تصفير أي قائمة «rm-more» مفتوحة عند إعادة الرسم — لا تبقى مفتوحة على منتج آخر.
  body.querySelectorAll("details.rm-more[open]").forEach((d) => { d.open = false; });
  body.scrollTop = 0;
}

// طابور حي أثناء المراجعة (بلاغ المالك 2026-09-14، مرتين): القائمة كانت تُحمَّل مرة عند الفتح، فالوصف الثاني يجهز
// والتاجر يراجع الأول ولا يظهر إلا بإغلاق النافذة. الإصلاح الأول انتظر إشعار متتبّع الجملة وحده — يضيع إن كتب
// الـcron الوصف أو حُدّثت الصفحة. الآن النافذة نفسها تسأل كل ٨ ثوانٍ ما دامت على المراجعة، والإشعار يعجّلها.
// الجديد يدخل **مباشرة بعد المنتج الحالي** بلا إعادة رسم الخطوة (تعديل قيد الكتابة لا يضيع)، والمقرَّر للتو لا يعود.
const LIVE_MS = 8000;
let liveTimer = null;

function startLive() {
  if (!liveTimer) liveTimer = setInterval(() => { if (!document.hidden) appendReadyRows(); }, LIVE_MS);
}

function stopLive() {
  clearInterval(liveTimer);
  liveTimer = null;
}

async function appendReadyRows() {
  if (!modalOpen() || M.phase !== "review" || M.busy || M.loading) return;
  try {
    const { data } = await postReviewList("pending", 100);
    if (!data?.ok || M.busy || M.loading || M.phase !== "review") return;
    const known = new Set(M.rows.map((r) => r.id));
    const fresh = (data.rows || data.items || []).filter((r) => !known.has(r.id) && !M.decided.has(r.id));
    M.pendingTotal = Number(data.counts?.pending ?? M.pendingTotal);
    if (data.counts) setReviewCounts(data.counts);
    if (!fresh.length) return;
    const wasEmpty = !M.rows.length;
    M.rows.splice(wasEmpty ? 0 : M.index + 1, 0, ...fresh);
    if (wasEmpty) {
      M.index = 0;
      renderStep();
    } else {
      $("rmCounter").innerText = `${M.index + 1} من ${M.rows.length}`;
      $("rmStepBar").style.width = Math.round(((M.index + 1) / M.rows.length) * 100) + "%";
      $("rmNext").disabled = M.index >= M.rows.length - 1;
      $("rmApproveAllCount").innerText = String(Math.max(M.pendingTotal, M.rows.length));
    }
    const first = fresh[0].name || fresh[0].sku || "منتج";
    setMsg(fresh.length === 1 ? `جهز وصف «${first}» — تلقاه بعد هذا المنتج.` : `جهزت ${fresh.length} أوصاف جديدة — تلقاها بعد هذا المنتج.`, "success");
  } catch (e) { /* الإشعار التالي يعيد المحاولة */ }
}
document.addEventListener("hala:review-ready", appendReadyRows);

function scheduleSave() {
  M.dirty = true;
  setSaveState("تعديلات لم تُحفظ بعد");
  clearTimeout(M.saveTimer);
  M.saveTimer = setTimeout(saveNow, SAVE_IDLE_MS);
}

/** يحفظ ما لم يُحفظ (بالتسلسل — لا حفظان متوازيان) ويرجّع true إن لم يبقَ شيء معلّق. */
function saveNow() {
  clearTimeout(M.saveTimer);
  M.saveChain = M.saveChain.then(persistEdits, persistEdits);
  return M.saveChain;
}

async function persistEdits() {
  const r = M.rows[M.index];
  const body = $("rmBody");
  if (!M.dirty || !r || !body.querySelector("#rmDesc")) return true;
  const fields = collectFields(body);
  if (!fields.description) {
    setMsg("الوصف فارغ — اكتب نصاً أو ارفض المنتج.", "error");
    return false;
  }
  M.dirty = false;
  setSaveState("جاري الحفظ…");
  const data = await postReviewDecide({ action: "update", id: r.id, fields }).catch(() => null);
  if (!data?.ok) {
    M.dirty = true;
    setSaveState("");
    setMsg(data?.error || "تعذر حفظ تعديلك — تأكد من الإنترنت وجرّب مرة ثانية.", "error");
    return false;
  }
  mergeFields(r, fields);
  if (!M.dirty) setSaveState("حُفظت تعديلاتك");
  return true;
}

export async function reviewModalNav(delta) {
  if (M.busy || !M.rows.length) return;
  if (!(await saveNow())) return;
  const next = Math.min(M.rows.length - 1, Math.max(0, M.index + delta));
  if (next === M.index) return;
  M.index = next;
  renderStep();
}

function setDecisionButtons(disabled) {
  ["rmApprove", "rmReject", "rmSkip", "rmApproveAll", "rmPrev", "rmNext"].forEach((id) => { const b = $(id); if (b) b.disabled = disabled; });
}

function announceDecision(rows, action) {
  rows.forEach((r) => document.dispatchEvent(new CustomEvent("hala:review-decided", { detail: { sku: r.sku, action } })));
}

export async function reviewModalDecide(action) {
  if (M.busy || !M.rows.length) return;
  const r = M.rows[M.index];
  if (action === "skip") {
    if (!(await saveNow())) return;
    if (M.rows.length > 1) { M.index = (M.index + 1) % M.rows.length; renderStep(); }
    else setMsg("هذا آخر وصف ينتظر — اعتمده أو ارفضه، أو أغلق النافذة ويبقى بانتظارك.");
    return;
  }
  M.busy = true;
  setDecisionButtons(true);
  setMsg(action === "approve" ? "جاري الاعتماد…" : "جاري الرفض…");
  try {
    if (action === "approve" && !(await saveNow())) return;
    const data = await postReviewDecide({ action, ids: [r.id] });
    if (!data?.ok) { setMsg(data?.error || "تعذر التنفيذ — جرّب مرة ثانية.", "error"); return; }
    if (data.counts) setReviewCounts(data.counts);
    announceDecision([r], action);
    M.decided.add(r.id);
    if (action === "approve") maybeShowFeedback();
    M.rows.splice(M.index, 1);
    M.pendingTotal = Math.max(0, M.pendingTotal - 1);
    if (M.index >= M.rows.length) M.index = Math.max(0, M.rows.length - 1);
    renderStep();
    const name = r.name || r.sku || "المنتج";
    setMsg(action === "approve" ? `اعتُمد «${name}» — يُنشر على سلة خلال دقائق.` : `رُفض «${name}» — ما يُنشر.`, action === "approve" ? "success" : "info");
  } catch (e) {
    setMsg("تعذر الاتصال — تأكد من الإنترنت وجرّب مرة ثانية.", "error");
  } finally {
    M.busy = false;
    setDecisionButtons(false);
    if (M.rows.length) { $("rmPrev").disabled = M.index === 0; $("rmNext").disabled = M.index >= M.rows.length - 1; }
  }
}

export async function reviewModalApproveAll() {
  if (M.busy || !M.rows.length) return;
  if (!(await saveNow())) return;
  const n = Math.max(M.pendingTotal, M.rows.length);
  // «اعتمد الكل» ينشر على متجر حي — لا يمر بضغطة عابرة، والرسالة تقول بالضبط ما يصير.
  const confirmed = await confirmAction({
    title: `اعتماد ونشر ${n} وصف`,
    message: `نعتمد كل الأوصاف الجاهزة بانتظار مراجعتك (${n}) كما هي الآن بتعديلاتك المحفوظة، وننشرها على متجرك بسلة تدريجياً (بحدود سلة: ~٢٠ منتجاً كل ١٠ دقائق). الأقسام اللي أطفأت فيها «ينشر» ما تُنشر، والأوصاف اللي لسه تنكتب ما تدخل بهذا الاعتماد. تقدر تتراجع عن أي منتج بعد نشره من «المراجعة والنشر».`,
    confirmText: "اعتمد وانشر الكل",
    cancelText: "إلغاء",
    variant: "warning"
  });
  if (!confirmed) return;
  M.busy = true;
  setDecisionButtons(true);
  setMsg("جاري اعتماد الكل…");
  try {
    const data = await postReviewDecide({ action: "approve_all" });
    if (!data?.ok) { setMsg(data?.error || "تعذر التنفيذ — جرّب مرة ثانية.", "error"); return; }
    if (data.counts) setReviewCounts(data.counts);
    announceDecision(M.rows, "approve");
    M.rows.forEach((x) => M.decided.add(x.id));
    maybeShowFeedback();
    const approved = data.approved ?? n;
    M.rows = [];
    M.index = 0;
    M.pendingTotal = 0;
    renderStep();
    setMsg(`اعتُمد ${approved} — يُنشر على سلة تدريجياً خلال دقائق.`, "success");
  } catch (e) {
    setMsg("تعذر الاتصال — تأكد من الإنترنت وجرّب مرة ثانية.", "error");
  } finally {
    M.busy = false;
    setDecisionButtons(false);
  }
}

export async function closeReviewModal() {
  const modal = $("reviewModal");
  if (!modal || modal.classList.contains("hidden")) return;
  // تعديل لم يُحفظ (فشل اتصال أو وصف فارغ) ⇒ لا نغلق فيضيع — الرسالة تقول السبب.
  if (M.phase === "review" && !(await saveNow())) return;
  modal.classList.add("hidden");
  stopLive();
  // نافذة «المراجعة والنشر» تحتها تبقى مفتوحة إن كانت — والصفحة لا تتمرر خلفها.
  if ($("reviewPanel")?.classList.contains("hidden") !== false) document.body.style.overflow = "";
  if (M.lastFocus && document.contains(M.lastFocus)) M.lastFocus.focus?.();
  loadReview("pending");
  document.dispatchEvent(new Event("hala:review-modal-closed"));
}

async function onPanelClick(e) {
  // 2026-09-17: النقر خارج قائمة «rm-more» المفتوحة، أو على زر داخل نافذتها
  // المنبثقة، يغلقها — بدل ما تبقى مفتوحة فوق باقي الأزرار.
  const openMore = $("rmPanel")?.querySelector("details.rm-more[open]");
  if (openMore && (!e.target.closest("details.rm-more") || e.target.closest(".rm-more-pop button"))) {
    openMore.open = false;
  }
  const btn = e.target.closest("[data-rm-action]");
  if (!btn) return;
  const action = btn.dataset.rmAction;
  if (action === "close" || action === "minimize") { closeReviewModal(); return; }
  if (action === "reload") { loadRows(); return; }
  if (action === "to-progress") {
    if (M.phase === "review" && !(await saveNow())) return;
    document.dispatchEvent(new Event("hala:show-progress"));
    return;
  }
  if (action === "add") {
    const list = $("rmBody").querySelector(`.rm-list[data-kind="${btn.dataset.kind}"]`);
    if (!list) return;
    if (list.children.length >= Number(list.dataset.max || 8)) { setMsg(`وصلت للحد (${list.dataset.max}) بهذا القسم.`); return; }
    list.insertAdjacentHTML("beforeend", emptyRow(btn.dataset.kind));
    list.parentElement.querySelector(".rm-list-empty")?.classList.add("hidden");
    list.lastElementChild?.querySelector("input, textarea")?.focus();
    return;
  }
  if (action === "remove") {
    const row = btn.closest(".rm-hl-row, .rm-spec-row, .rm-faq-row");
    const list = row?.parentElement;
    row?.remove();
    if (list && !list.children.length) list.parentElement.querySelector(".rm-list-empty")?.classList.remove("hidden");
    scheduleSave();
  }
}

function onBodyInput(e) {
  if (e.target.id === "rmSeoTitle" || e.target.id === "rmMeta") updateSeoPreview($("rmBody"), M.rows[M.index]?.name);
  if (e.target.matches("input, textarea")) scheduleSave();
}

function onBodyChange(e) {
  if (!e.target.classList.contains("rm-toggle")) return;
  syncToggle(e.target);
  scheduleSave();
}

/** حبس التركيز داخل النافذة — Tab وShift+Tab يدوران بين عناصرها الظاهرة. */
function trapFocus(e) {
  const panel = $("rmPanel");
  const items = [...panel.querySelectorAll("button, [href], input, select, textarea, summary, [tabindex]:not([tabindex='-1'])")]
    .filter((el) => !el.disabled && el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// Esc يغلق، Tab محبوس، والأسهم تتنقل خارج حقول الكتابة — اتجاه الصفحة من اليمين لليسار: ← التالي، → السابق.
document.addEventListener("keydown", (e) => {
  if (!modalOpen()) return;
  // 2026-09-17: Escape أثناء فتح قائمة «rm-more» يغلق القائمة فقط ويرجع التركيز
  // لزر فتحها، بدل إغلاق النافذة كلها فوق رأس التاجر.
  const openMore = $("rmPanel")?.querySelector("details.rm-more[open]");
  if (e.key === "Escape" && openMore) {
    e.preventDefault();
    openMore.open = false;
    openMore.querySelector("summary")?.focus();
    return;
  }
  if (e.key === "Escape") { e.preventDefault(); closeReviewModal(); return; }
  if (e.key === "Tab") { trapFocus(e); return; }
  if (M.phase !== "review" || e.target?.closest?.("input, textarea, select, [contenteditable]")) return;
  if (e.key === "ArrowLeft") reviewModalNav(1);
  if (e.key === "ArrowRight") reviewModalNav(-1);
});

$("rmPanel")?.addEventListener("click", onPanelClick);
$("rmBody")?.addEventListener("input", onBodyInput);
$("rmBody")?.addEventListener("change", onBodyChange);
