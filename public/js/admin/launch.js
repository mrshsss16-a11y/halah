// public/js/admin/launch.js — متابعة الإطلاق المحدود: أرقام حقيقية من D1.
import { adminLaunch } from "./api.js";

const esc = (v) => window.escHtml(v);

export async function loadLaunch() {
  const kpis = document.getElementById("launchKpis");
  kpis.innerHTML = '<div class="col-span-4 text-slate-500 p-4">جاري التحميل…</div>';
  try {
    const data = await adminLaunch();
    if (!data?.ok) { kpis.innerHTML = `<div class="col-span-4 text-rose-700 p-4">${esc(data?.error || "تعذر التحميل")}</div>`; return; }
    const st = data.stats || {};
    const kpi = (label, val, sub) => `<div class="rounded-2xl border border-slate-200 p-3"><div class="text-2xl font-black text-black">${esc(val ?? "—")}</div><div class="text-[11px] font-bold text-slate-700">${esc(label)}</div>${sub ? `<div class="text-[10px] text-slate-500">${esc(sub)}</div>` : ""}</div>`;
    kpis.innerHTML = [
      kpi("متاجر نشطة ٧ أيام", st.activeMerchants7d, `من ${st.merchantsTotal} · اليوم ${st.activeMerchants1d}`),
      kpi("رسائل واتساب واردة ٧ أيام", st.whatsappIn7d, `ردود: ${st.whatsappOut7d}`),
      kpi("جلسات ودجت ٧ أيام", st.widgetSessions7d ?? "غير متاح"),
      kpi("حجوزات ٧ أيام", st.bookings7d),
      kpi("أوصاف مولَّدة ٧ أيام", st.descriptionsGenerated7d, `نُشر: ${st.descriptionsPublished7d}`),
      kpi("طابور المراجعة", st.reviewPending, `بانتظار النشر ${st.reviewAwaitingPublish} · فشل ${st.reviewPublishFailed}`),
      kpi("أخطاء ٢٤ ساعة", st.errors24h),
      kpi("تقييم ٣٠ يوم", st.feedbackAvg30d === null ? "لا تقييمات" : `${st.feedbackAvg30d}/5`, `${st.feedbackCount30d} تقييم`)
    ].join("");
    document.getElementById("launchErrors").innerHTML = (st.topErrors24h || []).length
      ? "أكثر الأخطاء ٢٤ ساعة: " + st.topErrors24h.map((e) => `<span class="font-mono">${esc(e.code)}</span> ×${esc(e.count)}`).join(" · ")
      : "صفر أخطاء آخر ٢٤ ساعة.";
    const act = document.getElementById("launchActivity");
    act.innerHTML = (data.activity || []).map((a) => `<tr><td class="p-2 font-bold">${esc((a.storeName || a.email || a.merchantId) + (a.disabled ? " (معطّل)" : ""))}</td><td class="p-2 font-mono text-slate-600">${esc((a.lastActiveAt || "—").slice(0, 16))}</td><td class="p-2">${esc(a.catalogCount)}</td><td class="p-2">${esc(a.publishedCount)}</td><td class="p-2">${esc(a.waMessages7d)}</td></tr>`).join("") || '<tr><td colspan="5" class="p-3 text-slate-500">لا تجار بعد.</td></tr>';
    const fb = document.getElementById("launchFeedback");
    fb.innerHTML = (data.feedback || []).map((f) => `<div class="rounded-xl border border-slate-200 p-3"><div class="flex justify-between"><span class="font-black">${esc(f.score)}/5 — ${esc(f.store_name || f.merchant_id)}</span><span class="text-[10px] text-slate-500 font-mono">${esc((f.created_at || "").slice(0, 16))}</span></div><div class="mt-1 text-slate-700">${esc(f.comment || "")}</div></div>`).join("") || '<div class="text-slate-500">لا تغذية راجعة بعد.</div>';
  } catch (e) { kpis.innerHTML = '<div class="col-span-4 text-rose-700 p-4">تعذر الاتصال.</div>'; }
}
