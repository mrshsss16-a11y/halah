// public/js/dashboard/tabs.js — تبديل تبويبات اللوحة والتحميل الكسول لكل تبويب.
import { S } from "./state.js";
import { loadCatalog } from "./catalog.js";
import { loadReview } from "./review.js";
import { loadAgentContext } from "./agent.js";
import { loadWaStatus } from "./whatsapp.js";
import { loadStore } from "./store.js";

export function switchTab(tab) {
  const tabs = ["studio", "catalog", "agent", "store"];
  tabs.forEach((t) => {
    const btn = document.getElementById("navTab" + t.charAt(0).toUpperCase() + t.slice(1));
    const sec = document.getElementById("section" + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) btn.className = (t === tab ? "tab-on" : "tab-off") + " text-xs font-bold px-4 py-2.5 rounded-xl transition flex items-center gap-2" + (t === tab ? " shadow-sm" : "");
    if (sec) sec.classList.toggle("hidden", t !== tab);
  });
  if (tab === "agent") { loadAgentContext(); loadWaStatus(); }
  if (tab === "store") loadStore();
  if (tab === "catalog" && !S.catalogLoadedOnce) loadCatalog(0);
  if (tab === "studio" && !S.reviewLoadedOnce) { S.reviewLoadedOnce = true; loadReview("pending"); }
}
