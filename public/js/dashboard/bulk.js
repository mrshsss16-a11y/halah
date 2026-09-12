// public/js/dashboard/bulk.js — التوليد بالجملة (B3): رفع قائمة ملصوقة، أو
// توليد من الكتالوج المسحوب، ومتابعة تقدّم الوظيفة.
import { S } from "./state.js";
import { postBulkUpload, postBulkStatus, postBulkGenerateAll } from "./api.js";
import { loadReview } from "./review.js";

const escHtml = window.escHtml;

/** نبرة واحدة ظاهرة بشريط «منتجاتي» لكل مسارات التوليد (مفرد، محدد، للكل، ملصوق). */
export function toneValue() {
  return document.getElementById("pTone")?.value || "white";
}
const showMsg = (id, text, type) => window.showMsg(id, text, type);

export function parseBulkRows(raw) {
  return raw.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const [name, price, category, sku] = line.split(",").map((s) => (s || "").trim());
    return { name, price, category, sku };
  }).filter((r) => r.name && r.sku);
}

export async function startBulkJob() {
  const rows = parseBulkRows(document.getElementById("bulkRows").value);
  if (!rows.length) { showMsg("bulkFeedback", "أدخل صف واحد على الأقل بصيغة اسم,سعر,فئة,SKU.", "error"); return; }

  const btn = document.getElementById("bulkBtn");
  btn.disabled = true;
  document.getElementById("bulkFeedback").classList.add("hidden");

  try {
    const { data } = await postBulkUpload(rows, toneValue());
    if (!data?.ok) {
      showMsg("bulkFeedback", data?.error || "تعذر بدء المعالجة.", "error");
      btn.disabled = false;
      return;
    }
    // رسالة الخادم تقول كم بدأ اليوم وكم تأجّل — كانت تُهمَل فيظن التاجر أن الكل اليوم.
    showMsg("bulkFeedback", (data.message ? data.message + " " : "") + `تم استلام ${data.queued} منتج — تقدير الوقت ${data.etaMinutes} دقيقة.`, "success");
    // الرسالة والشريط بشريط «منتجاتي» أعلى الصفحة، والزر بآخرها — نمرّر إليهما.
    document.getElementById("bulkFeedback")?.scrollIntoView({ behavior: "smooth", block: "center" });
    pollBulkJob(data.jobId);
  } catch (e) {
    showMsg("bulkFeedback", "تعذر الاتصال.", "error");
    btn.disabled = false;
  }
}

export async function pollBulkJob(jobId) {
  if (S.bulkPollTimer) clearInterval(S.bulkPollTimer);
  // مسار «ولّد أوصاف المحدد» كان يتتبّع وظيفته بشريط مخفي — لا تقدّم ظاهر أبداً.
  document.getElementById("bulkProgress")?.classList.remove("hidden");
  let pollFailures = 0;
  const tick = async () => {
    try {
      const { res, data } = await postBulkStatus(jobId);
      if (!res.ok || !data?.ok) throw new Error("status failed");
      pollFailures = 0;

      const pct = data.total ? Math.round((data.processed / data.total) * 100) : 0;
      document.getElementById("bulkProgressBar").style.width = pct + "%";
      document.getElementById("bulkProgressCount").innerText = `${data.processed} / ${data.total}`;

      // sku comes from the merchant's uploaded CSV and error from caught
      // Salla API responses — escape both before innerHTML (SECURITY_AUDIT L5).
      // escHtml comes from /js/shared.js.
      const failedEl = document.getElementById("bulkFailedList");
      failedEl.innerHTML = (data.failedItems || []).map((i) => `${escHtml(i.sku)} — ${escHtml(i.error || "فشل")}`).join("<br>");

      if (data.status === "done") {
        document.getElementById("bulkProgressLabel").innerText = `اكتمل: ${data.succeeded} جاهز للمراجعة، ${data.failed} فشل/مؤجَّل`;
        clearInterval(S.bulkPollTimer);
        document.getElementById("bulkBtn").disabled = false;
        loadReview("pending");
      } else if (data.succeeded > 0 && (data.processed % 20 === 0)) {
        loadReview(S.reviewState);
      }
    } catch (e) {
      // الشريط كان يتجمّد بصمت للأبد — بعد ٣ فشل متتالٍ نقول ما يصير.
      pollFailures += 1;
      if (pollFailures >= 3) {
        document.getElementById("bulkProgressLabel").innerText = "توقّف تتبّع التقدّم مؤقتاً بسبب مشكلة اتصال — عملك لسه شغّال بالخلفية، اضغط «تحديث» بتبويب المراجعة لمتابعته.";
      }
    }
  };
  tick();
  S.bulkPollTimer = setInterval(tick, 15000);
}

// ── توليد من الكتالوج (المرحلة ٢) ─────────────────────────
export async function startCatalogGenerate() {
  const btn = document.getElementById("bulkGenerateBtn");
  btn.disabled = true;
  document.getElementById("bulkFeedback").classList.add("hidden");
  try {
    const { data } = await postBulkGenerateAll(toneValue());
    if (!data?.ok) { showMsg("bulkFeedback", data?.error || "تعذر بدء التوليد.", "error"); btn.disabled = false; return; }
    // upgradeHint («رقّي الباقة») لا يُعرض: لا مسار ترقية باللوحة، فهو وعد بلا زر.
    showMsg("bulkFeedback", data.message + ` — تبدأ المعالجة خلال ~١٠ دقائق (كل ١٠ دقائق دفعة، تقدير الإكمال: ~${data.etaMinutes} دقيقة).`, "info");
    pollBulkJob(data.jobId);
  } catch (e) { showMsg("bulkFeedback", "تعذر الاتصال.", "error"); }
  btn.disabled = false;
}
