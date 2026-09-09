// public/js/admin/overview.js — مؤشرات لوحة الإشراف العامة (KPI).
import { adminOverview } from "./api.js";

export async function loadAdminData() {
  try {
    const data = await adminOverview();
    if (data?.ok && data?.stats) {
      if (document.getElementById("kpiMerchants")) document.getElementById("kpiMerchants").innerText = data.stats.merchantsCount ?? data.stats.merchants ?? 1;
      if (document.getElementById("kpiBookings")) document.getElementById("kpiBookings").innerText = data.stats.bookingsCount ?? data.stats.bookings ?? 0;
      if (document.getElementById("kpiTotalUsageToday")) document.getElementById("kpiTotalUsageToday").innerText = `${data.stats.totalCreditsUsedToday ?? 0} رصيد`;
      if (document.getElementById("kpiActive7d")) document.getElementById("kpiActive7d").innerText = data.stats.activeMerchants7d ?? "--";
    }
  } catch (err) {
    console.error("Failed to load admin overview:", err);
  }
}
