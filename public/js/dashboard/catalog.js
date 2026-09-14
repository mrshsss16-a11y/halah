// public/js/dashboard/catalog.js — تبويب «منتجاتي» (كتالوج سلة المسحوب).
//
// الهدف: صفر كتابة يدوية. البطاقة تحمل بيانات المنتج كاملة بذاكرة الصفحة
// (S.catalogItems)، والنقر يعبّي حقول الاستوديو ثم يسأل «وش يميز المنتج؟» (اختياري) قبل generateCopy().
// أسماء/أوصاف/روابط سلة كلها من محتوى التاجر ⇒ كل إدراج بـinnerHTML يمرّ
// بـescHtml (ثغرة XSS أُغلقت بهذا المسار — لا تُعاد).
import { S } from "./state.js";
import { iconSvg, setIcon } from "./icons.js";
import { fetchCatalogList, postCatalogSync, postBulkGenerateSelected } from "./api.js";
import { renderIdentityLine } from "./render.js";
import { setPublishTarget, generateCopy } from "./studio.js";
import { pollBulkJob, toneValue } from "./bulk.js";
import { pageButtons } from "./pager.js";
import { openNotesModal } from "./notes.js";

const escHtml = window.escHtml;
const showMsg = (id, text, type) => window.showMsg(id, text, type);
// يطابق limit=24 بـapi.js · fetchCatalogList.
const PAGE_SIZE = 24;
// اسم وصورة كل منتج محدد — التحديد يعبر الصفحات وS.catalogItems يحمل الصفحة الحالية فقط، وقائمة «جاري التجهيز» تحتاجهما.
const pickedMeta = new Map();

// تحديث ذاتي أثناء سحب بالخلفية: كل ٢٠ ثانية، ويتوقف لما يخلص السحب.
function scheduleCatalogRefresh() {
  if (S.catalogRefreshTimer) return;
  S.catalogRefreshTimer = setTimeout(async () => {
    S.catalogRefreshTimer = null;
    // تاجر انتقل لصفحة ثانية أثناء السحب: لا نرجعه للأولى كل ٢٠ ثانية.
    if (S.catalogPage > 0) return;
    await loadCatalog(0);
  }, 20000);
}

// زر الجملة بلا منتجات مسحوبة = وعد يفشل بأول ضغطة.
export function setBulkGenerateEnabled(on) {
  const b = document.getElementById("bulkGenerateBtn");
  if (!b) return;
  b.disabled = !on;
  b.title = on ? "" : "اسحب منتجاتك من سلة أولاً";
  b.classList.toggle("opacity-50", !on);
  b.classList.toggle("cursor-not-allowed", !on);
}

export async function loadCatalog(offset = 0, { keepFeedback = false } = {}) {
  const grid = document.getElementById("catalogGrid");
  const loading = document.getElementById("catalogLoading");
  const empty = document.getElementById("catalogEmpty");
  const pager = document.getElementById("catalogPager");

  // تحميل يدوي يلغي أي تحديث ذاتي معلّق — لا تحميلان متوازيان.
  if (S.catalogRefreshTimer) { clearTimeout(S.catalogRefreshTimer); S.catalogRefreshTimer = null; }
  // صفحات مرقّمة: كل تحميل يعرض صفحة واحدة، والتحديد المتعدد يبقى عبر الصفحات (S.selectedSkus).
  S.catalogItems = {};
  grid.innerHTML = "";
  S.catalogPage = Math.floor(offset / PAGE_SIZE);
  // رسالة «اسحب منتجاتي» كانت تُمسح بنفس اللحظة لأن السحب يعيد تحميل الشبكة فوراً — «لمحة وتختفي» (2026-09-14).
  if (!keepFeedback) document.getElementById("catalogFeedback").classList.add("hidden");
  empty.classList.add("hidden");
  pager?.classList.add("hidden");
  loading.classList.remove("hidden");

  try {
    const { res, data } = await fetchCatalogList(offset);
    loading.classList.add("hidden");

    if (!res.ok || data?.error) {
      // الرمز بجانب الرسالة: التاجر ينقله لنا فنعرف السبب (جلسة، حساب، حد معدل) بلا تخمين.
      showMsg("catalogFeedback", `${data?.error || "تعذر تحميل منتجاتك. حاول مرة ثانية."}${data?.code ? ` (${data.code})` : ` (HTTP ${res.status})`}`, "error");
      return;
    }

    S.catalogLoadedOnce = true;
    const items = data.items || [];
    // مفتاح البطاقة: SKU وإلا معرّف سلة — صفّان بلا SKU كانا يدهس أحدهما الآخر.
    items.forEach((it) => {
      const key = it.sku || ("pid_" + it.productId);
      S.catalogItems[key] = it;
      grid.appendChild(catalogCard(it, key));
    });

    const count = Object.keys(S.catalogItems).length;
    grid.classList.toggle("hidden", count === 0);
    document.getElementById("catalogSelectBar").classList.toggle("hidden", count === 0);
    renderCatalogSelection();
    S.catalogNextOffset = data.nextOffset || 0;
    S.lastCatalogTotal = Number(data.total || 0);
    renderPager(S.lastCatalogTotal);
    setBulkGenerateEnabled(S.lastCatalogTotal > 0);
    renderIdentityLine();

    // الحالة الفارغة تقول الحقيقة بدل نص واحد لثلاث حالات مختلفة:
    //   syncing  ⇒ سحب شغّال بالخلفية (تلقائي عند الربط أو من الزر)
    //   synced   ⇒ سُحب ولم يُعثر على شيء (أو كل المنتجات بلا SKU)
    //   غير ذلك ⇒ لم يبدأ سحب بعد
    if (count === 0) {
      const title = document.getElementById("catalogEmptyTitle");
      const hint = document.getElementById("catalogEmptyHint");
      const icon = document.getElementById("catalogEmptyIcon");
      if (data.syncing) {
        setIcon(icon, "sync");
        title.innerText = "جاري سحب منتجاتك من سلة…";
        hint.innerText = "أول دفعة توصل خلال ثوانٍ. الصفحة تتحدّث لحالها.";
        scheduleCatalogRefresh();
      } else if (data.synced) {
        setIcon(icon, "inventory_2");
        title.innerText = "متجرك مربوط، لكن ما لقينا منتجات نقدر نحفظها.";
        hint.innerText = "تأكد أن منتجاتك منشورة بسلة ولها رموز SKU، ثم اضغط «اسحب منتجاتي».";
      } else if (S.storeLinked === false) {
        // متجر غير مربوط: زر السحب سيفشل — الخطوة الصحيحة هي الربط لا السحب.
        setIcon(icon, "storefront");
        title.innerText = "متجرك غير مربوط بسلة بعد — اربطه أولاً من تبويب «متجري».";
        hint.innerText = "بعد الربط تُسحب منتجاتك بصورها تلقائياً وتظهر هنا.";
      } else {
        setIcon(icon, "inventory_2");
        title.innerText = 'ما سحبنا منتجاتك بعد — اضغط "اسحب منتجاتي من سلة"';
        hint.innerText = "تظهر أول دفعة منتجات فوراً، وإن كان متجرك كبير يوصل الباقي خلال دقائق.";
      }
    }
    empty.classList.toggle("hidden", count !== 0);

    // بقية الصفحات تصل بالخلفية — العدّاد يتحدّث بدل رقم جامد "خلال دقائق".
    if (data.syncing && count > 0) scheduleCatalogRefresh();

    document.getElementById("catalogCountLine").innerText = count
      ? `${offset + 1}–${offset + count} من ${data.total} منتج — اضغط أي منتج ويكتب الوصف تلقائياً من صورته ووصفه الحالي.`
      : "اضغط أي منتج ويكتب الوصف تلقائياً من صورته ووصفه الحالي.";
  } catch (err) {
    loading.classList.add("hidden");
    showMsg("catalogFeedback", "تعذر الاتصال. حاول مرة ثانية.", "error");
  }
}

/** أرقام الصفحات تحت الشبكة — صفحة واحدة ⇒ لا شريط. كل نص هنا ثابت أو رقم (innerText). */
function renderPager(total) {
  const nav = document.getElementById("catalogPager");
  if (!nav) return;
  const pages = Math.ceil(total / PAGE_SIZE);
  nav.innerHTML = "";
  nav.classList.toggle("hidden", pages <= 1);
  if (pages <= 1) return;
  const add = (label, page, { current = false, disabled = false, aria = "" } = {}) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerText = label;
    b.disabled = disabled;
    if (aria) b.setAttribute("aria-label", aria);
    if (current) b.setAttribute("aria-current", "page");
    b.className = (current ? "sleek-btn-black" : "sleek-btn-white") + " min-w-9 px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-40";
    if (!disabled && !current) b.addEventListener("click", () => goCatalogPage(page));
    nav.appendChild(b);
  };
  add("السابق", S.catalogPage - 1, { disabled: S.catalogPage === 0 });
  pageButtons(total, S.catalogPage, PAGE_SIZE).forEach((p) => {
    if (p === "…") {
      const gap = document.createElement("span");
      gap.className = "px-1 text-xs text-slate-500";
      gap.innerText = "…";
      nav.appendChild(gap);
    } else {
      add((p + 1).toLocaleString("ar-SA"), p, { current: p === S.catalogPage, aria: `الصفحة ${p + 1}` });
    }
  });
  add("التالي", S.catalogPage + 1, { disabled: S.catalogPage >= pages - 1 });
}

/** الانتقال لصفحة من «منتجاتي» — والشبكة تُمرَّر لمجال الرؤية. */
export function goCatalogPage(page) {
  const target = Math.max(0, Number(page) || 0);
  return loadCatalog(target * PAGE_SIZE).then(() => document.getElementById("catalogGrid")?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

export function catalogCard(it, key) {
  key = key || it.sku || ("pid_" + it.productId);
  // غلاف: البطاقة زر، ومربع الاختيار عنصر مستقل فوقها — زر داخل زر HTML
  // غير صالح ويكسر النقر بالمتصفحات.
  const wrap = document.createElement("div");
  wrap.className = "relative";
  wrap.dataset.sku = key;

  const card = document.createElement("button");
  card.type = "button";
  card.setAttribute("aria-label", "اكتب وصف " + (it.name || "المنتج"));
  card.className = "w-full text-right rounded-2xl border border-slate-200 bg-white overflow-hidden hover:border-black transition shadow-sm";
  card.dataset.sku = key;

  // صور سلة قد تكون محمية (hotlink/CDN مقيّد): لو فشل التحميل نُخفي الـimg
  // ونُظهر بديلاً نصياً بدل أيقونة مكسورة. onerror داخل السمة يحتاج تهريب
  // الاقتباسات — escHtml يهرّب ' و " أيضاً.
  const img = it.imageUrl
    ? `<img src="${escHtml(it.imageUrl)}" alt="${escHtml(it.name)}" loading="lazy" referrerpolicy="no-referrer"
          class="w-full aspect-[3/4] object-contain bg-slate-50"
          onerror="var f=this.parentElement&&this.parentElement.querySelector('.img-fallback'); if(f)f.classList.remove('hidden'); this.remove();"/>`
    : "";
  const badge = it.hasDescription
    ? ""
    : '<span class="absolute top-2 left-2 bg-black text-white text-[10px] font-bold px-2 py-0.5 rounded-full">بلا وصف</span>';
  // بلا SKU = خارج التوليد الجماعي فعلياً (الوظيفة تعرّف صفوفها بالـSKU) —
  // بطاقة صادقة تقول ذلك بدل مربع اختيار غائب بلا تفسير.
  const skuBadge = it.sku
    ? ""
    : '<span class="absolute top-2 right-2 bg-amber-700 text-white text-[10px] font-bold px-2 py-0.5 rounded-full" title="بلا SKU — لا يدخل التوليد الجماعي">بلا SKU</span>';
  // أيقونة «بلا صورة» قطعة مبنيّة داخلياً من ثوابت (لا نص من سلة) — تُسمّى كمتغيّر
  // مثل img/badge ليبقى حارس CATUI-12 صارماً على كل ما عداها.
  const noImageIcon = iconSvg("image_not_supported", "text-3xl text-slate-400");

  card.innerHTML =
    `<div class="relative">
       ${img}
       <div class="img-fallback ${it.imageUrl ? "hidden" : ""} w-full aspect-[3/4] bg-slate-100 flex items-center justify-center">
         ${noImageIcon}
       </div>
       ${badge}
       ${skuBadge}
     </div>
     <div class="p-2.5 space-y-1">
       <div class="text-xs font-bold text-black leading-snug truncate" title="${escHtml(it.name)}">${escHtml(it.name)}</div>
       <div class="text-[11px] text-slate-500">${escHtml(it.price || "")}${it.category ? " · " + escHtml(it.category) : ""}</div>
     </div>`;

  card.addEventListener("click", () => useCatalogItem(key));
  wrap.appendChild(card);

  // منتج بلا SKU لا يدخل التوليد الجماعي (الوظيفة تُعرّف صفوفها بالـSKU)،
  // فلا نعرض له مربع اختيار يعد بما لا يُنفَّذ.
  if (it.sku) {
    const pick = document.createElement("label");
    pick.className = "absolute top-2 right-2 z-10 flex items-center justify-center w-7 h-7 rounded-lg bg-white/95 border border-slate-300 cursor-pointer shadow-sm";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "catalog-pick w-4 h-4 accent-black cursor-pointer";
    box.value = it.sku;
    box.setAttribute("aria-label", "حدّد " + (it.name || it.sku));
    box.checked = S.selectedSkus.has(it.sku);
    box.addEventListener("change", () => {
      if (box.checked) { S.selectedSkus.add(it.sku); pickedMeta.set(it.sku, { sku: it.sku, name: it.name, imageUrl: it.imageUrl }); }
      else { S.selectedSkus.delete(it.sku); pickedMeta.delete(it.sku); }
      wrap.classList.toggle("ring-2", box.checked);
      wrap.classList.toggle("ring-black", box.checked);
      wrap.classList.toggle("rounded-2xl", box.checked);
      renderCatalogSelection();
    });
    pick.appendChild(box);
    wrap.appendChild(pick);
    if (box.checked) wrap.classList.add("ring-2", "ring-black", "rounded-2xl");
  }

  return wrap;
}

export function renderCatalogSelection() {
  const bar = document.getElementById("catalogSelectBar");
  const btn = document.getElementById("catalogSelectedGenBtn");
  const n = S.selectedSkus.size;
  if (!bar || !btn) return;
  document.getElementById("catalogSelectCount").innerText = `محدد: ${n}`;
  document.getElementById("catalogSelectedGenText").innerText =
    n ? `ولّد أوصاف المحدد (${n})` : "ولّد أوصاف المحدد";
  btn.disabled = n === 0;
  btn.classList.toggle("opacity-50", n === 0);
  btn.classList.toggle("cursor-not-allowed", n === 0);
}

export function selectAllCatalog(on) {
  document.querySelectorAll(".catalog-pick").forEach((box) => {
    if (box.checked !== on) { box.checked = on; box.dispatchEvent(new Event("change")); }
  });
}

/**
 * توليد للمنتجات المحددة — نفس مسار الجملة (طابور مراجعة، حد يومي والزائد
 * مؤجَّل يوماً بيوم، فاصل ١.١ث لكل متجر)، لكن بقائمة التاجر لا بترتيب الأولوية.
 */
// «ولّد أوصاف المحدد» ← نافذة «وش يميز منتجاتك؟» (اختيارية) ← البدء. السطر قبل تحليل الصورة لأن
// الخامة والمصدر والضمان لا تظهر بالصورة — والوصف يبني زاويته التسويقية عليها (طلب المالك 2026-09-14).
export function generateSelectedCatalog() {
  const skus = [...S.selectedSkus];
  if (!skus.length) return;
  openNotesModal(skus.map((sku) => pickedMeta.get(sku) || { sku, name: sku }), (notes) => startSelectedGenerate(skus, notes));
}

async function startSelectedGenerate(skus, notes) {
  // تُلتقط قبل مسح التحديد: قائمة «جاري التجهيز» تعرض كل منتج بصورته واسمه وحالته.
  const items = skus.map((sku) => pickedMeta.get(sku) || { sku, name: sku });
  const btn = document.getElementById("catalogSelectedGenBtn");
  const txt = document.getElementById("catalogSelectedGenText");
  btn.disabled = true;
  txt.innerText = "جاري البدء…";
  try {
    const tone = toneValue();
    const { res, data } = await postBulkGenerateSelected(skus, tone, notes);
    if (data?.code === "GENERATE_ALREADY_RUNNING" && data.jobId) {
      // وظيفة سابقة ما خلصت: نلتحق بها ونعرض تقدّمها — كانت رسالة خطأ بـcatalogFeedback يمسحها أول تحميل للشبكة.
      showMsg("bulkFeedback", data.error, "info");
      pollBulkJob(data.jobId, { note: data.error });
    } else if (!res.ok || !data?.ok) {
      showMsg("catalogFeedback", data?.error || "تعذر بدء التوليد. حاول مرة ثانية.", "error");
    } else {
      // التقدّم بنافذة «أوصاف منتجاتك» (bulk.js): كان شريطاً صامتاً لدقائق والجاهز يُرسم بنافذة مخفية — «يولد ويختفي».
      showMsg("bulkFeedback", (data.message || `بدأ توليد ${skus.length} وصفاً`) + " — تابع التجهيز بنافذة «أوصاف منتجاتك»، وراجع الجاهز منها أول ما يجهز.", "success");
      S.selectedSkus.clear();
      selectAllCatalog(false);
      pickedMeta.clear();
      renderCatalogSelection();
      if (data.jobId) pollBulkJob(data.jobId, { items, note: data.message });
    }
  } catch (e) {
    showMsg("catalogFeedback", "ما قدرنا نتصل — تأكد من الإنترنت وجرّب مرة ثانية.", "error");
  }
  txt.innerText = "ولّد أوصاف المحدد";
  renderCatalogSelection();
}

/** بطاقة → حقول الاستوديو → توليد فوري. لا إدخال يدوي إطلاقاً. */
export function useCatalogItem(sku) {
  const it = S.catalogItems[sku];
  if (!it) return;

  document.getElementById("pName").value = it.name || "";
  // السعر حقل رقمي؛ سلة تعطيه كنص فيه العملة ("350 SAR") — نأخذ الرقم فقط.
  const priceNum = String(it.price || "").match(/[\d.]+/);
  document.getElementById("pPrice").value = priceNum ? priceNum[0] : "";
  document.getElementById("pCategory").value = it.category || "";
  document.getElementById("pExistingDescription").value = it.currentDescription || "";
  document.getElementById("pImageUrl").value = it.imageUrl || "";
  // خيارات المنتج (ألوان/مقاسات) — تُحمل بالحالة لا بحقل ظاهر: بيانات سلة
  // لا يحرّرها التاجر، وعرضها نصاً JSON تشويش.
  S.selectedVariants = it.variants || null;

  const banner = document.getElementById("studioSourceBanner");
  // innerText لا innerHTML — اسم المنتج من سلة.
  document.getElementById("studioSourceText").innerText = "المصدر: " + (it.name || "") + " (" + sku + ") — مسحوب من سلة";
  banner.classList.remove("hidden");

  // وجهة النشر تُضبط آلياً من المنتج نفسه — لا يكتب التاجر معرّفاً بيده.
  setPublishTarget(it.productId, it.name);

  // لا قفز لتبويب ثانٍ: اللوحة تُفتح تحت الشبكة نفسها. أول ما يُضغط المنتج
  // تظهر حالة انتظار باسمه، فيرى التاجر أن شيئاً بدأ فعلاً — كان يحسّ أن
  // التوليد "بالخلفية" لأن الشاشة تتبدّل ولا أثر مرئي عندها.
  // سؤال «وش يميز هالمنتج؟» قبل تحليل الصورة — اختياري، و«اكتب الوصف الآن» يبدأ بدونه.
  askCatalogItemNote(it);
}

let askedItem = null;

function askCatalogItemNote(it) {
  // صفحة HTML قديمة من الكاش بلا بطاقة السؤال: التوليد المباشر كما كان، لا ضغطة بلا أثر.
  if (!document.getElementById("copyAsk") || !document.getElementById("copyAskNote")) {
    openCopyPanel(it);
    generateCopy();
    return;
  }
  askedItem = it;
  closeCopyPanel();
  document.getElementById("pFeatures").value = "";
  const note = document.getElementById("copyAskNote");
  note.value = "";
  // textContent لا innerHTML — الاسم والرابط من سلة.
  document.getElementById("copyAskName").textContent = it.name || "";
  const img = document.getElementById("copyAskImg");
  if (it.imageUrl) { img.src = it.imageUrl; img.classList.remove("hidden"); } else img.classList.add("hidden");
  const card = document.getElementById("copyAsk");
  card.classList.remove("hidden");
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  note.focus({ preventScroll: true });
}

/** «اكتب الوصف الآن» من بطاقة السؤال — السطر (إن كُتب) يصير مزايا المنتج بالتوليد. */
export function confirmCatalogItem() {
  if (!askedItem) return;
  const it = askedItem;
  askedItem = null;
  document.getElementById("pFeatures").value = document.getElementById("copyAskNote").value.replace(/\s+/g, " ").trim().slice(0, 300);
  document.getElementById("copyAsk").classList.add("hidden");
  openCopyPanel(it);
  generateCopy();
}

/** يفتح لوحة الوصف بحالة انتظار ويمرّرها لمجال الرؤية — بلا تبديل تبويب. */
export function openCopyPanel(it) {
  const pending = document.getElementById("copyPending");
  const result = document.getElementById("copyResult");
  const feedback = document.getElementById("copyFeedback");
  if (feedback) feedback.classList.add("hidden");
  if (result) result.classList.add("hidden");
  if (pending) {
    // innerText لا innerHTML — الاسم من سلة.
    const nameEl = document.getElementById("copyPendingName");
    if (nameEl) nameEl.innerText = it?.name || "";
    pending.classList.remove("hidden");
    pending.scrollIntoView({ behavior: "smooth", block: "center" });
    // نداءان متتاليان (رؤية ثم كتابة) ≈ ١٥ ثانية. مؤشر بنص ثابت يبدو معلّقاً؛
    // تبديل النص عند الثانية السابعة يعكس المرحلة الفعلية بصدق.
    const stage = document.getElementById("copyPendingStage");
    if (stage) {
      stage.innerText = "الخطوة ١ من ٢ — تحليل صورة المنتج…";
      clearTimeout(window.__halaStageTimer);
      window.__halaStageTimer = setTimeout(() => {
        if (!pending.classList.contains("hidden")) stage.innerText = "الخطوة ٢ من ٢ — كتابة الوصف والسيو…";
      }, 7000);
    }
  }
  // رأس اللوحة: صورة المنتج واسمه — يعرف التاجر أي منتج يراجع بلا تخمين.
  const img = document.getElementById("copyResultImg");
  if (img) {
    if (it?.imageUrl) { img.src = it.imageUrl; img.classList.remove("hidden"); }
    else img.classList.add("hidden");
  }
  const rName = document.getElementById("copyResultName");
  if (rName) rName.innerText = it?.name || "";
}

/** إغلاق اللوحة — الشبكة تبقى كما هي، لا إعادة تحميل. */
export function closeCopyPanel() {
  clearTimeout(window.__halaStageTimer);
  document.getElementById("copyAsk")?.classList.add("hidden");
  document.getElementById("copyPending")?.classList.add("hidden");
  document.getElementById("copyResult")?.classList.add("hidden");
  document.getElementById("copyFeedback")?.classList.add("hidden");
}

export async function startCatalogSync() {
  const btn = document.getElementById("catalogSyncBtn");
  const txt = document.getElementById("catalogSyncBtnText");
  btn.disabled = true;
  txt.innerText = "جاري السحب…";
  try {
    const { res, data } = await postCatalogSync();
    if (!res.ok || data?.error) {
      showMsg("catalogFeedback", `${data?.error || "تعذر بدء السحب. حاول مرة ثانية."}${data?.code ? ` (${data.code})` : ` (HTTP ${res.status})`}`, "error");
    } else {
      // الرسالة تجي من الخادم بناءً على نتيجة الصفحة الأولى الحقيقية
      // (عدد مسحوب فعلاً + هل بقي شيء) — لا وعد بما لم يحصل.
      showMsg("catalogFeedback", data.message || "تم سحب منتجات متجرك.", "success");
      await loadCatalog(0, { keepFeedback: true });
      // نجح ⇒ الزر يصير «تحديث» ويهدأ ٦٠ ثانية: الضغط المتكرر كان يصطدم
      // بحد المعدل (٣ محاولات/٥ دقائق) فيُعاقَب التاجر على فعل بدا مسموحاً.
      txt.innerText = "تحديث المنتجات";
      if (S.syncCooldownTimer) clearTimeout(S.syncCooldownTimer);
      S.syncCooldownTimer = setTimeout(() => { btn.disabled = false; S.syncCooldownTimer = null; }, 60000);
      return;
    }
  } catch (err) {
    showMsg("catalogFeedback", "تعذر الاتصال. حاول مرة ثانية.", "error");
  }
  btn.disabled = false;
  txt.innerText = "اسحب منتجاتي من سلة";
}

/** بعد نشر مفرد ناجح: البطاقة بـ«منتجاتي» تعكس أن للمنتج وصفاً الآن —
    بلا انتظار إعادة تحميل الكتالوج كاملاً. */
export function markCatalogCardPublished(productId) {
  const it = Object.values(S.catalogItems).find((p) => String(p.productId) === String(productId));
  if (!it) return;
  it.hasDescription = true;
  const key = it.sku || ("pid_" + it.productId);
  const card = document.querySelector('#catalogGrid [data-sku="' + CSS.escape(key) + '"]');
  const badge = card && card.querySelector(".absolute.top-2.left-2");
  if (badge) badge.remove();
}
