// public/js/admin/tabs.js — تبديل أقسام لوحة الإشراف والتحميل الكسول لكل قسم.
import { loadAccountsList, loadBookingsList } from "./accounts.js";
import { loadAuraWaConfig } from "./aurawa.js";
import { loadLaunch } from "./launch.js";

let activeTab = "overview";

export function switchAdminTab(tab) {
  activeTab = tab;
  const tabs = ["overview", "auraWa", "accounts", "bookings", "tester", "images", "launch"];
  tabs.forEach((t) => {
    const btn = document.getElementById("navTab" + t.charAt(0).toUpperCase() + t.slice(1));
    const sec = document.getElementById("section" + t.charAt(0).toUpperCase() + t.slice(1));
    if (t === tab) {
      if (btn) btn.className = "text-xs font-bold px-4.5 py-2.5 rounded-xl bg-black text-white transition flex items-center gap-2 shadow-sm";
      if (sec) sec.classList.remove("hidden");
    } else {
      if (btn) btn.className = "text-xs font-bold px-4.5 py-2.5 rounded-xl text-slate-700 hover:text-black hover:bg-slate-100 transition flex items-center gap-2";
      if (sec) sec.classList.add("hidden");
    }
  });

  if (tab === "accounts") loadAccountsList();
  if (tab === "bookings") loadBookingsList();
  if (tab === "auraWa") loadAuraWaConfig();
  if (tab === "launch") loadLaunch();
}

export function currentAdminTab() {
  return activeTab;
}
