// public/js/dashboard/catalog.js — تبويب «منتجاتي» (كتالوج سلة المسحوب).
//
// الهدف: صفر كتابة يدوية. البطاقة تحمل بيانات المنتج كاملة بذاكرة الصفحة
// (S.catalogItems)، والنقر يعبّي حقول الاستوديو ويشغّل generateCopy() فوراً.
// أسماء/أوصاف/روابط سلة كلها من محتوى التاجر ⇒ كل إدراج بـinnerHTML يمرّ
// بـescHtml (ثغرة XSS أُغلقت بهذا المسار — لا تُعاد).
import { S } from "./state.js";
import { fetchCatalogList, postCatalogSync, postBulkGenerateSelected } from "./api.js";
import { renderIdentityLine } from "./render.js";
import { switchTab } from "./tabs.js";
import { setPublishTarget, generateCopy } from "./studio.js";
import { pollBulkJob } from "./bulk.js";

const escHtml = window.escHtml;
const showMsg = (id, text, type) => window.showMsg(id, text, type);

// تحديث ذاتي أثناء سحب بالخلفية: كل ٢٠ ثانية، ويتوقف لما يخلص السحب.
function scheduleCatalogRefresh() {
  if (S.catalogRefreshTimer) return;
  S.catalogRefreshTimer = setTimeout(async () => {
    S.catalogRefreshTimer = null;
    // تاجر ضغط «عرض المزيد» أثناء السحب: لا نمسح صفحاته كل ٢٠ ثانية.
    if (S.catalogNextOffset > 0) return;
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

export async function loadCatalog(offset = 0) {
  const grid = document.getElementById("catalogGrid");
  const loading = document.getElementById("catalogLoading");
  const empty = document.getElementById("catalogEmpty");
  const moreBtn = document.getElementById("catalogMoreBtn");

  // تحميل يدوي يلغي أي تحديث ذاتي معلّق — لا تحميلان متوازيان.
  if (S.catalogRefreshTimer) { clearTimeout(S.catalogRefreshTimer); S.catalogRefreshTimer = null; }
  if (offset === 0) { S.catalogItems = {}; grid.innerHTML = ""; }
  document.getElementById("catalogFeedback").classList.add("hidden");
  empty.classList.add("hidden");
  moreBtn.classList.add("hidden");
  loading.classList.remove("hidden");

  try {
    const { res, data } = await fetchCatalogList(offset);
    loading.classList.add("hidden");

    if (!res.ok || data?.error) {
      showMsg("catalogFeedback", data?.error || "تعذر تحميل منتجاتك. حاول مرة ثانية.", "error");
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
    moreBtn.classList.toggle("hidden", !data.hasMore);
    S.lastCatalogTotal = Number(data.total || 0);
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
        icon.innerText = "sync";
        title.innerText = "جاري سحب منتجاتك من سلة…";
        hint.innerText = "أول دفعة توصل خلال ثوانٍ. الصفحة تتحدّث لحالها.";
        scheduleCatalogRefresh();
      } else if (data.synced) {
        icon.innerText = "inventory_2";
        title.innerText = "متجرك مربوط، لكن ما لقينا منتجات نقدر نحفظها.";
        hint.innerText = "تأكد أن منتجاتك منشورة بسلة ولها رموز SKU، ثم اضغط «اسحب منتجاتي».";
      } else {
        icon.innerText = "inventory_2";
        title.innerText = 'ما سحبنا منتجاتك بعد — اضغط "اسحب منتجاتي من سلة"';
        hint.innerText = "تظهر أول دفعة منتجات فوراً، وإن كان متجرك كبير يوصل الباقي خلال دقائق.";
      }
    }
    empty.classList.toggle("hidden", count !== 0);

    // بقية الصفحات تصل بالخلفية — العدّاد يتحدّث بدل رقم جامد "خلال دقائق".
    if (data.syncing && count > 0) scheduleCatalogRefresh();

    document.getElementById("catalogCountLine").innerText = count
      ? `${count} من ${data.total} منتج — اضغط أي منتج ويكتب الوصف تلقائياً من صورته ووصفه الحالي.`
      : "اضغط أي منتج ويكتب الوصف تلقائياً من صورته ووصفه الحالي.";
  } catch (err) {
    loading.classList.add("hidden");
    showMsg("catalogFeedback", "تعذر الاتصال. حاول مرة ثانية.", "error");
  }
}

/** زر «عرض المزيد» — كان onclick="loadCatalog(catalogNextOffset)" على متغيّر عام. */
export function loadCatalogMore() {
  return loadCatalog(S.catalogNextOffset);
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
  card.className = "w-full text-right rounded-2xl border border-slate-200 bg-white overflow-hidden hover:border-black transition shadow-sm";
  card.dataset.sku = key;

  // صور سلة قد تكون محمية (hotlink/CDN مقيّد): لو فشل التحميل نُخفي الـimg
  // ونُظهر بديلاً نصياً بدل أيقونة مكسورة. onerror داخل السمة يحتاج تهريب
  // الاقتباسات — escHtml يهرّب ' و " أيضاً.
  const img = it.imageUrl
    ? `<img src="${escHtml(it.imageUrl)}" alt="${escHtml(it.name)}" loading="lazy" referrerpolicy="no-referrer"
          class="w-full h-28 object-cover bg-slate-100"
          onerror="var f=this.parentElement&&this.parentElement.querySelector('.img-fallback'); if(f)f.classList.remove('hidden'); this.remove();"/>`
    : "";
  const badge = it.hasDescription
    ? ""
    : '<span class="absolute top-2 left-2 bg-black text-white text-[10px] font-bold px-2 py-0.5 rounded-full">بلا وصف</span>';
  // بلا SKU = خارج التوليد الجماعي فعلياً (الوظيفة تعرّف صفوفها بالـSKU) —
  // بطاقة صادقة تقول ذلك بدل مربع اختيار غائب بلا تفسير.
  const skuBadge = it.sku
    ? ""
    : '<span class="absolute top-2 right-2 bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">بلا SKU — لا يدخل التوليد الجماعي</span>';

  card.innerHTML =
    `<div class="relative">
       ${img}
       <div class="img-fallback ${it.imageUrl ? "hidden" : ""} w-full h-28 bg-slate-100 flex items-center justify-center">
         <span class="material-symbols-outlined text-3xl text-slate-400">image_not_supported</span>
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
    box.checked = S.selectedSkus.has(it.sku);
    box.addEventListener("change", () => {
      if (box.checked) S.selectedSkus.add(it.sku); else S.selectedSkus.delete(it.sku);
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
 * توليد للمنتجات المحددة — نفس مسار الجملة (طابور مراجعة، احترام حصة
 * الشهر، فاصل ١.١ث لكل متجر)، لكن بقائمة التاجر لا بترتيب الأولوية.
 */
export async function generateSelectedCatalog() {
  const skus = [...S.selectedSkus];
  if (!skus.length) return;
  const btn = document.getElementById("catalogSelectedGenBtn");
  const txt = document.getElementById("catalogSelectedGenText");
  btn.disabled = true;
  txt.innerText = "جاري البدء…";
  try {
    const tone = document.getElementById("bulkTone")?.value || "white";
    const { res, data } = await postBulkGenerateSelected(skus, tone);
    if (!res.ok || !data?.ok) {
      showMsg("catalogFeedback", data?.error || "تعذر بدء التوليد. حاول مرة ثانية.", "error");
    } else {
      showMsg("catalogFeedback", (data.message || `بدأ توليد ${skus.length} وصفاً`) + " — تبدأ المعالجة خلال ~١٠ دقائق (كل ١٠ دقائق دفعة)، وراجعها بتبويب «وصف المنتجات» قبل النشر.", "success");
      S.selectedSkus.clear();
      selectAllCatalog(false);
      renderCatalogSelection();
      if (data.jobId) pollBulkJob(data.jobId);
      switchTab("studio");
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

  const banner = document.getElementById("studioSourceBanner");
  // innerText لا innerHTML — اسم المنتج من سلة.
  document.getElementById("studioSourceText").innerText = "المصدر: " + (it.name || "") + " (" + sku + ") — مسحوب من سلة";
  banner.classList.remove("hidden");

  // وجهة النشر تُضبط آلياً من المنتج نفسه — لا يكتب التاجر معرّفاً بيده.
  setPublishTarget(it.productId, it.name);

  switchTab("studio");
  window.scrollTo({ top: 0, behavior: "smooth" });
  generateCopy();
}

export async function startCatalogSync() {
  const btn = document.getElementById("catalogSyncBtn");
  const txt = document.getElementById("catalogSyncBtnText");
  btn.disabled = true;
  txt.innerText = "جاري السحب…";
  try {
    const { res, data } = await postCatalogSync();
    if (!res.ok || data?.error) {
      showMsg("catalogFeedback", data?.error || "تعذر بدء السحب. حاول مرة ثانية.", "error");
    } else {
      // الرسالة تجي من الخادم بناءً على نتيجة الصفحة الأولى الحقيقية
      // (عدد مسحوب فعلاً + هل بقي شيء) — لا وعد بما لم يحصل.
      showMsg("catalogFeedback", data.message || "تم سحب منتجات متجرك.", "success");
      await loadCatalog(0);
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
