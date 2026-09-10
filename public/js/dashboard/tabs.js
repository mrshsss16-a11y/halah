// public/js/dashboard/tabs.js — تبديل تبويبات اللوحة والتحميل الكسول لكل تبويب.
import { S } from "./state.js";
import { loadCatalog } from "./catalog.js";
import { loadReview } from "./review.js";
import { loadAgentContext } from "./agent.js";
import { loadStore } from "./store.js";

export function switchTab(tab) {
  // «وصف المنتجات» دُمج داخل «منتجاتي» — أي نداء قديم يُحوَّل بدل أن يُخفي كل شيء.
  if (tab === "studio") tab = "catalog";
  const tabs = ["catalog", "agent", "store"];
  tabs.forEach((t) => {
    const btn = document.getElementById("navTab" + t.charAt(0).toUpperCase() + t.slice(1));
    const sec = document.getElementById("section" + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) btn.className = (t === tab ? "tab-on" : "tab-off") + " text-xs font-bold px-4 py-2.5 rounded-xl transition flex items-center gap-2" + (t === tab ? " shadow-sm" : "");
    if (sec) sec.classList.toggle("hidden", t !== tab);
  });
  if (tab === "agent") loadAgentContext();
  if (tab === "store") loadStore();
  if (tab === "catalog") {
    if (!S.catalogLoadedOnce) loadCatalog(0);
    // طابور المراجعة بنفس التبويب الآن — يُحمَّل مرة واحدة معه.
    if (!S.reviewLoadedOnce) { S.reviewLoadedOnce = true; loadReview("pending"); }
  }
}
