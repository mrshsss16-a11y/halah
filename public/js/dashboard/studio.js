// public/js/dashboard/studio.js — استوديو وصف المنتج المفرد ووجهة النشر على سلة.
import { S } from "./state.js";
import { postCopy, postPublish, postCategory } from "./api.js";
import { renderCopy, renderPublishTarget, showPublishSuccess, showPublishError } from "./render.js";
import { markCatalogCardPublished } from "./catalog.js";
import { revertReview } from "./review.js";
import { loadUsage } from "./store.js";

const showMsg = (id, text, type) => window.showMsg(id, text, type);

// ── Product copy ──────────────────────────────────────────
export async function generateCopy() {
  const name = document.getElementById("pName").value.trim();
  if (!name) { showMsg("copyFeedback", "اكتب اسم المنتج أولاً.", "error"); return; }

  const btn = document.getElementById("genBtn");
  const btnText = document.getElementById("genBtnText");
  btn.disabled = true;
  btnText.innerText = "جاري الكتابة… ⚡";
  document.getElementById("copyFeedback").classList.add("hidden");

  try {
    const { res, data } = await postCopy({
      name,
      price: document.getElementById("pPrice").value,
      category: document.getElementById("pCategory").value.trim(),
      tone: document.getElementById("pTone").value,
      features: document.getElementById("pFeatures").value.trim(),
      existingDescription: document.getElementById("pExistingDescription").value.trim(),
      imageUrl: document.getElementById("pImageUrl").value.trim()
    });

    // خطأ خادم بلا حقل error كان يمرّ كنجاح فيعرض مربعات فارغة بصمت.
    const emptyResult = !data || (!data.copywriting && !data.result);
    if (!res.ok || data?.error || emptyResult) {
      showMsg("copyFeedback", data?.error || "ما قدرنا نولّد الوصف هالمرة — جرّب تضغط «اكتب الوصف الآن» مرة ثانية.", "error");
    } else {
      S.lastCopy = data;
      renderCopy(data);
      document.getElementById("copyResult").classList.remove("hidden");
      // بلا صورة الوصف مبني على الاسم والنص فقط — يُقال صراحةً لا يُخفى.
      const noImg = document.getElementById("copyNoImageNote");
      if (noImg) noImg.classList.toggle("hidden", !!data.usedImage);
      renderCategoryMismatch(data.categoryMismatch);
      loadUsage();
    }
  } catch (err) {
    showMsg("copyFeedback", "تعذر الاتصال. حاول مرة ثانية.", "error");
  }

  btn.disabled = false;
  btnText.innerText = "اكتب الوصف الآن";
}

/**
 * تنبيه التصنيف — رُصد فستان مصنَّفاً تحت «التنانير» بمتجر حي، وهالة تراه
 * فستاناً بالصورة وتسكت. تُعرض المقارنة بنص صريح، والقرار للتاجر: التصنيف
 * يُغيَّر من سلة بيده، لا نكتبه نيابة عنه.
 */
function renderCategoryMismatch(mismatch) {
  const box = document.getElementById("categoryMismatchNote");
  if (!box) return;
  if (!mismatch?.detected || !mismatch?.current) {
    box.classList.add("hidden");
    return;
  }
  // innerText لا innerHTML — النصان مشتقّان من بيانات سلة ومن مخرج النموذج.
  document.getElementById("categoryMismatchText").innerText =
    `هالة تشوف المنتج ${mismatch.detected}، لكنه مصنَّف بمتجرك تحت ${mismatch.current}.`;
  box.classList.remove("hidden");
  const btn = document.getElementById("applyCategoryBtn");
  const btnText = document.getElementById("applyCategoryBtnText");
  const msg = document.getElementById("applyCategoryMsg");
  if (btn) {
    // منتج بلا معرّف سلة لا يُطبَّق عليه شيء — الزر يختفي بدل أن يفشل بالضغط.
    const hasTarget = Boolean(S.selectedCatalogProduct?.productId);
    btn.classList.toggle("hidden", !hasTarget);
    btn.disabled = false;
    if (btnText) btnText.innerText = "طبّق التصنيف على سلة";
  }
  if (msg) msg.innerText = "";
}

/**
 * تطبيق التصنيف الذي اقترحته هالة — **بضغطة التاجر لا تلقائياً**.
 *
 * الخادم يقرأ تصنيفات المنتج أولاً ويستبدل المتعارض وحده، فتبقى التصنيفات
 * التسويقية («وصل حديثاً»، «تخفيضات») كما هي. لا تصنيف باسم النوع بالمتجر ⇒
 * رسالة تطلب إنشاءه، ولا نخترع تصنيفاً.
 */
export async function applySuggestedCategory() {
  const mismatch = S.lastCopy?.categoryMismatch;
  const productId = S.selectedCatalogProduct?.productId;
  if (!mismatch?.detected || !productId) return;
  const btn = document.getElementById("applyCategoryBtn");
  const btnText = document.getElementById("applyCategoryBtnText");
  const msg = document.getElementById("applyCategoryMsg");
  btn.disabled = true;
  btnText.innerText = "جاري التطبيق…";
  msg.innerText = "";
  try {
    const { res, data } = await postCategory({ productId, type: mismatch.detected });
    if (!res.ok || !data?.ok) {
      msg.innerText = data?.error || "ما قدرنا نطبّق التصنيف — جرّب مرة ثانية.";
      btn.disabled = false;
      btnText.innerText = "طبّق التصنيف على سلة";
      return;
    }
    msg.innerText = data.message || "تم ✅";
    btnText.innerText = "طُبّق ✅";
  } catch (e) {
    msg.innerText = "تعذر الاتصال. حاول مرة ثانية.";
    btn.disabled = false;
    btnText.innerText = "طبّق التصنيف على سلة";
  }
}

// ── وجهة النشر ────────────────────────────────────────────────────
// اختيار منتج من "منتجاتي" يضبط قائمة النشر آلياً. القائمة تبقى قابلة
// للتعديل: التاجر يقدر يختار منتجاً آخر يدوياً وقتها نحدّث السطر التوضيحي.
export function setPublishTarget(productId, name) {
  const sel = document.getElementById("publishProduct");
  const id = productId == null ? "" : String(productId);
  // صف كتالوج قديم بلا معرّف سلة: لا نترك وجهة سابقة معلّقة تضلّل التاجر —
  // لكن الصندوق يبقى ظاهراً مع سبب صريح، لا يختفي بصمت فيظن أن النشر ميزة مدفوعة.
  if (!sel || !id) {
    S.selectedCatalogProduct = null;
    onPublishProductChange();
    const box = document.getElementById("publishBox");
    if (box) box.classList.remove("hidden");
    const line = document.getElementById("publishTargetLine");
    if (line) {
      line.innerText = "هذا المنتج بلا معرّف سلة — اضغط «اسحب منتجاتي» مرة ثانية لتحديثه، ثم اختره من جديد.";
      line.classList.remove("hidden");
    }
    return;
  }

  // المنتج قد لا يكون ضمن الخيارات المحمّلة من حالة المتجر — نضيفه.
  let opt = Array.prototype.find.call(sel.options, (o) => o.value === id);
  if (!opt) {
    opt = document.createElement("option");
    opt.value = id;
    opt.innerText = name || id; // innerText لا innerHTML — اسم من سلة.
    sel.appendChild(opt);
  }
  sel.value = id;
  S.selectedCatalogProduct = { productId: id, name: name || "" };
  document.getElementById("publishBox").classList.remove("hidden");
  renderPublishTarget();
}

export function onPublishProductChange() {
  const sel = document.getElementById("publishProduct");
  const id = sel && sel.value ? String(sel.value) : "";
  if (!id) { S.selectedCatalogProduct = null; }
  else if (!S.selectedCatalogProduct || S.selectedCatalogProduct.productId !== id) {
    const opt = sel.options[sel.selectedIndex];
    S.selectedCatalogProduct = { productId: id, name: opt ? opt.text : "" };
  }
  renderPublishTarget();
}

/** «أعد التوليد» — نفس بيانات المنتج المعبّاة بالاستوديو، بلا إعادة كتابة. */
export function regenerateCopy() {
  document.getElementById("publishFeedback").classList.add("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
  generateCopy();
}

// قفل النشر: ضغطة مزدوجة على «اعتمد وانشر» يجب ألا ترسل طلبين.
// العلم يُفحص قبل أي await، والزر يُعطَّل نصياً — حزامان لا واحد.
export async function publishToSalla() {
  if (S.publishing) return;
  const sel = document.getElementById("publishProduct");
  const productId = (sel && sel.value) || (S.selectedCatalogProduct && S.selectedCatalogProduct.productId) || "";
  if (!productId) {
    showPublishError("اختر المنتج أولاً من تبويب «منتجاتي» أو من القائمة أعلاه.");
    return;
  }
  if (!S.lastCopy) {
    showPublishError("ولّد الوصف أولاً قبل النشر.");
    return;
  }
  // Publish whatever the merchant is looking at right now, including any
  // edits they made in the review textarea — not the original AI draft.
  const editedDescription = document.getElementById("outDescription").value.trim();

  S.publishing = true;
  const btn = document.getElementById("publishBtn");
  const btnText = document.getElementById("publishBtnText");
  const regen = document.getElementById("regenBtn");
  if (btn) btn.disabled = true;
  if (regen) regen.disabled = true;
  if (btnText) btnText.innerText = "جاري النشر…";
  const fb = document.getElementById("publishFeedback");
  fb.classList.add("hidden");

  try {
    const { data } = await postPublish({
      productId,
      description: editedDescription || S.lastCopy.copywriting?.description || S.lastCopy.result,
      // حقول السيو والنقاط والأسئلة تُنشر مع الوصف (services/sallaProductPayload.js):
      // metadata_title/metadata_description/subtitle + وصف HTML منظّم.
      seo: S.lastCopy.seo || null,
      copywriting: S.lastCopy.copywriting || null,
      faqs: S.lastCopy.faqs || []
    });
    if (data?.ok) {
      const publishedItem = Object.values(S.catalogItems).find((p) => String(p.productId) === String(productId));
      showPublishSuccess(data.revertAvailable, publishedItem?.sku || "", revertReview);
      markCatalogCardPublished(productId);
    }
    else showPublishError(data?.error, data?.code);
  } catch (e) {
    showPublishError("ما قدرنا نتصل بسلة — تأكد من الإنترنت وجرّب مرة ثانية.");
  }

  S.publishing = false;
  if (btn) btn.disabled = false;
  if (regen) regen.disabled = false;
  if (btnText) btnText.innerText = "اعتمد وانشر على سلة";
}
