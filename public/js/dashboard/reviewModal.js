// public/js/dashboard/reviewModal.js — مراجعة الأوصاف واحداً واحداً بنافذة (طلب المالك 2026-09-13): صورة المنتج،
// و«قبل» (وصفه الحالي على سلة) بجانب «بعد» (الجديد، قابل للتعديل)، وما يُنشر معه، ثم اعتماد أو رفض أو «لاحقاً»،
// و«اعتمد الكل». نفس نقطة القرار (review/decide) — لا مسار نشر ثانٍ يتجاوز بوابة المراجعة.
import { S } from "./state.js";
import { confirmAction } from "./embedded.js";
import { postReviewList, postReviewDecide } from "./api.js";
import { publishExtras, setReviewCounts, loadReview } from "./review.js";

const escHtml = window.escHtml;
const M = { rows: [], index: 0, busy: false, dirty: false };
const $ = (id) => document.getElementById(id);
const plain = (html) => String(html || "").replace(/<\/(?:p|li|h\d|div)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

export async function openReviewModal(startId) {
  const modal = $("reviewModal");
  if (!modal) return;
  if (S.reviewState === "pending" && S.reviewRows.length) {
    M.rows = [...S.reviewRows];
  } else {
    const { data } = await postReviewList("pending", 100).catch(() => ({ data: null }));
    M.rows = data?.ok ? data.rows || [] : [];
    if (data?.counts) setReviewCounts(data.counts);
  }
  M.index = Math.max(0, M.rows.findIndex((r) => r.id === Number(startId)));
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  renderReviewModal();
  $("rmDesc")?.focus();
}

export function closeReviewModal() {
  $("reviewModal")?.classList.add("hidden");
  // نافذة «المراجعة والنشر» تحتها تبقى مفتوحة إن كانت — والصفحة لا تتمرر خلفها.
  if ($("reviewPanel")?.classList.contains("hidden") !== false) document.body.style.overflow = "";
  loadReview("pending");
}

function setDecisionButtons(disabled) {
  ["rmApprove", "rmReject", "rmSkip", "rmApproveAll"].forEach((id) => { const b = $(id); if (b) b.disabled = disabled; });
}

function renderReviewModal() {
  const body = $("rmBody");
  const total = M.rows.length;
  $("rmCounter").innerText = total ? `${M.index + 1} من ${total}` : "";
  $("rmActions").classList.toggle("hidden", !total);
  $("rmMsg").innerText = "";
  M.dirty = false;
  if (!total) {
    body.innerHTML = '<div class="py-12 text-center space-y-2"><p class="text-sm font-black text-black">خلصت المراجعة ✅</p><p class="text-xs text-slate-600">المعتمد يُنشر على سلة تدريجياً خلال دقائق، وتقدر تتراجع عن أي منتج بعد نشره.</p></div>';
    return;
  }
  const r = M.rows[M.index];
  const before = plain(r.currentDescription);
  body.innerHTML = `
    <div class="flex items-center gap-3">
      ${r.imageUrl ? `<img src="${escHtml(r.imageUrl)}" referrerpolicy="no-referrer" alt="" class="w-16 h-16 rounded-xl object-cover bg-slate-100" onerror="this.remove()">` : ""}
      <div class="min-w-0">
        <div class="text-sm font-black text-black truncate">${escHtml(r.name || r.sku || "")}</div>
        <div class="text-[11px] text-slate-500" dir="auto"><bdi>${escHtml(r.sku || "")}</bdi>${r.category ? " · <bdi>" + escHtml(r.category) + "</bdi>" : ""}</div>
      </div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div class="space-y-1.5">
        <span class="block text-[11px] font-black text-slate-600">قبل — الوصف الحالي على سلة</span>
        <div class="h-56 overflow-y-auto rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-black leading-relaxed whitespace-pre-wrap">${before ? escHtml(before) : '<span class="text-slate-500 font-bold">بلا وصف حالي</span>'}</div>
      </div>
      <div class="space-y-1.5">
        <label for="rmDesc" class="block text-[11px] font-black text-black">بعد — الوصف الجديد (عدّله قبل الاعتماد)</label>
        <textarea id="rmDesc" class="w-full h-56 bg-white border-2 border-slate-400 rounded-xl p-3 text-xs text-black leading-relaxed focus:outline-none focus:border-black">${escHtml(r.description || "")}</textarea>
      </div>
    </div>
    ${publishExtras(r)}`;
  $("rmDesc").addEventListener("input", () => { M.dirty = true; });
  $("rmPrev").disabled = M.index === 0;
  $("rmNext").disabled = M.index >= total - 1;
}

/** تعديل التاجر يُحفظ قبل أي انتقال أو اعتماد — وإلا ضاع أو نُشر النص الأصلي. */
async function saveEditIfNeeded(r) {
  const ta = $("rmDesc");
  if (!ta || !M.dirty) return true;
  const text = ta.value.trim();
  if (!text) { $("rmMsg").innerText = "الوصف فارغ — اكتب نصاً أو ارفض المنتج."; return false; }
  const data = await postReviewDecide({ action: "update", id: r.id, description: text }).catch(() => null);
  if (!data?.ok) { $("rmMsg").innerText = data?.error || "تعذر حفظ تعديلك."; return false; }
  r.description = text;
  M.dirty = false;
  return true;
}

export async function reviewModalNav(delta) {
  if (M.busy || !M.rows.length) return;
  if (!(await saveEditIfNeeded(M.rows[M.index]))) return;
  M.index = Math.min(M.rows.length - 1, Math.max(0, M.index + delta));
  renderReviewModal();
}

export async function reviewModalDecide(action) {
  if (M.busy || !M.rows.length) return;
  const r = M.rows[M.index];
  if (action === "skip") {
    if (!(await saveEditIfNeeded(r))) return;
    M.index = (M.index + 1) % M.rows.length;
    renderReviewModal();
    return;
  }
  M.busy = true;
  setDecisionButtons(true);
  $("rmMsg").innerText = action === "approve" ? "جاري الاعتماد…" : "جاري الرفض…";
  try {
    if (action === "approve" && !(await saveEditIfNeeded(r))) return;
    const data = await postReviewDecide({ action, ids: [r.id] });
    if (!data?.ok) { $("rmMsg").innerText = data?.error || "تعذر التنفيذ."; return; }
    if (data.counts) setReviewCounts(data.counts);
    M.rows.splice(M.index, 1);
    if (M.index >= M.rows.length) M.index = Math.max(0, M.rows.length - 1);
    renderReviewModal();
  } catch (e) {
    $("rmMsg").innerText = "تعذر الاتصال.";
  } finally {
    M.busy = false;
    setDecisionButtons(false);
  }
}

export async function reviewModalApproveAll() {
  if (M.busy || !M.rows.length) return;
  if (!(await saveEditIfNeeded(M.rows[M.index]))) return;
  // «اعتمد الكل» ينشر على متجر حي — لا يمر بضغطة عابرة.
  const confirmed = await confirmAction({
    title: "اعتماد كل الأوصاف",
    message: `نعتمد ${M.rows.length} وصف بانتظار مراجعتك وننشرها على متجرك بسلة تدريجياً؟ تقدر تتراجع عن أي منتج بعد النشر.`,
    confirmText: "اعتمد وانشر الكل",
    cancelText: "إلغاء",
    variant: "warning"
  });
  if (!confirmed) return;
  M.busy = true;
  setDecisionButtons(true);
  try {
    const data = await postReviewDecide({ action: "approve_all" });
    if (!data?.ok) { $("rmMsg").innerText = data?.error || "تعذر التنفيذ."; return; }
    if (data.counts) setReviewCounts(data.counts);
    M.rows = [];
    M.index = 0;
    renderReviewModal();
  } catch (e) {
    $("rmMsg").innerText = "تعذر الاتصال.";
  } finally {
    M.busy = false;
    setDecisionButtons(false);
  }
}

// Esc يغلق، والأسهم تتنقل (خارج مربع التعديل) — اتجاه الصفحة من اليمين لليسار.
document.addEventListener("keydown", (e) => {
  if ($("reviewModal")?.classList.contains("hidden") !== false) return;
  if (e.key === "Escape") { closeReviewModal(); return; }
  if (e.target && e.target.id === "rmDesc") return;
  if (e.key === "ArrowLeft") reviewModalNav(1);
  if (e.key === "ArrowRight") reviewModalNav(-1);
});
