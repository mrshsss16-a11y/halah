// public/js/dashboard/main.js — نقطة الدخول الوحيدة للوحة التاجر.
//
// ثلاث مسؤوليات فقط: (١) نشر الدوال التي تستدعيها سمات onclick بالـHTML على
// window، (٢) تركيب مستمعي النافذة، (٣) تسلسل تهيئة الصفحة بنفس ترتيبه السابق
// حرفياً: establishSallaEmbeddedSession ← /api/auth/me ← loadUsage/loadStore/
// loadCatalog/loadReview. أي إعادة ترتيب هنا تغيير سلوكي.
//
// <script type="module"> مؤجَّل بطبيعته: ينفَّذ بعد تحليل المستند وقبل إطلاق
// DOMContentLoaded — فمستمع DOMContentLoaded أدناه يعمل كما كان بالنص المضمّن.
import { installAccountGate, submitCompleteAccount, closeAccountModal } from "./account.js";
import { postAuthMe, postSallaEmbedded } from "./api.js";
import { S } from "./state.js";
import { switchTab } from "./tabs.js";
import {
  loadCatalog, loadCatalogMore, startCatalogSync, selectAllCatalog,
  generateSelectedCatalog, useCatalogItem, closeCopyPanel, setBulkGenerateEnabled
} from "./catalog.js";
import { generateCopy, regenerateCopy, publishToSalla, onPublishProductChange, applySuggestedCategory } from "./studio.js";
import { startBulkJob, startCatalogGenerate } from "./bulk.js";
import {
  loadReview, reloadReview, decideReview, decideOne, toggleReviewAll, saveReviewEdit,
  retryReview, revertReview, dismissFeedback, pickFeedbackScore, sendFeedback
} from "./review.js";
import { saveAgentContext, sendChat } from "./agent.js";
import { launchWhatsAppSignup, installWaSignupListener } from "./whatsapp.js";
import { loadStore, loadUsage, handleMerchantLogout } from "./store.js";
import { copyToClipboard, renderIdentityLine } from "./render.js";

// لفّ fetch أولاً: بوابة ACCOUNT_REQUIRED لازم تسبق أي نداء شبكة.
installAccountGate();
installWaSignupListener();

// ── الدوال التي تستدعيها سمات onclick/onchange/onkeydown بالـHTML ──
// وحدات ES لها نطاقها الخاص، والسمات المضمّنة تُقيَّم بالنطاق العام — فالنشر
// الصريح هنا هو ما يبقي المعالجات تعمل. مصدر واحد لكل اسم: هذه القائمة.
Object.assign(window, {
  switchTab,
  handleMerchantLogout,
  // منتجاتي
  loadCatalog, loadCatalogMore, startCatalogSync, selectAllCatalog,
  generateSelectedCatalog, useCatalogItem, closeCopyPanel,
  // الاستوديو والنشر
  generateCopy, regenerateCopy, publishToSalla, onPublishProductChange, copyToClipboard,
  applySuggestedCategory,
  // الجملة
  startBulkJob, startCatalogGenerate,
  // المراجعة والتغذية الراجعة
  loadReview, reloadReview, decideReview, decideOne, toggleReviewAll, saveReviewEdit,
  retryReview, revertReview, dismissFeedback, pickFeedbackScore, sendFeedback,
  // الوكيل وواتساب
  saveAgentContext, sendChat, launchWhatsAppSignup,
  // إكمال الحساب
  submitCompleteAccount, closeAccountModal
});

// Salla Easy-Mode merchants never sign up with email/password — the ONLY
// way to know who they are when this page opens inside Salla's dashboard
// iframe is the short-lived token the Salla SDK hands us. Outside an
// iframe (direct browser visit), that token doesn't exist and the normal
// cookie-session / login.html flow is what applies.
const inSallaFrame = window.self !== window.top;

async function establishSallaEmbeddedSession() {
  if (!window.salla?.embedded) return false;
  try {
    await window.salla.embedded.init({ debug: false });
    const token = window.salla.embedded.auth.getToken();
    if (!token) return false;

    const { data } = await postSallaEmbedded(token);
    if (!data.ok) {
      console.error("[salla-embedded-auth]", data.error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[salla-embedded-auth]", e);
    return false;
  }
}

// رجوع بالمتصفح قد يعرض DOM حساب سابق لحظياً قبل إعادة الجلب — أعد التحميل.
window.addEventListener("pageshow", (e) => { if (e.persisted) location.reload(); });

document.addEventListener("DOMContentLoaded", async () => {
  let sallaSessionOk = true;
  if (inSallaFrame) {
    sallaSessionOk = await establishSallaEmbeddedSession();
    if (!sallaSessionOk) {
      // Redirecting to /login here would just get silently blocked —
      // login.html refuses to be framed by design. Exit the embedded view
      // instead of leaving the merchant on a stuck loading screen —
      // لكن بكلمة أولاً: إغلاق صامت = "التطبيق خرب" في نظر التاجر.
      window.showToast("ما قدرنا نفتح لوحتك من داخل سلة. أعد تحميل الصفحة، وإذا تكرر افتحها مباشرة من hala-ai-os.pages.dev", "error");
      window.salla?.embedded?.destroy?.();
      return;
    }
  }

  try {
    const { data } = await postAuthMe();
    if (!data?.loggedIn) {
      if (inSallaFrame) { window.salla?.embedded?.destroy?.(); return; }
      window.location.href = "/login";
      return;
    }
    // الهوية دائماً ظاهرة: أي متجر وأي حساب — رُصد تاجر بثلاثة حسابات لا
    // يعرف أيها مفتوح. بالذاكرة فقط، لا تخزين محلي (جهاز مشترك = تسريب).
    const storeLabel = data?.storeName || "لوحة متجرك";
    document.getElementById("navStoreTitle").innerText = storeLabel;
    document.getElementById("merchantHeroHeader").innerText = storeLabel;
    window.__accountEmail = data?.email || "";
    renderIdentityLine();
    const snippetEl = document.getElementById("widgetSnippet");
    if (snippetEl && data?.storeId) {
      snippetEl.innerText = '<script src="https://hala-ai-os.pages.dev/widget.js" data-store-id="' + data.storeId + '"><' + "/script>";
    }
    if (data?.isAdmin) document.getElementById("adminPortalBtn").classList.remove("hidden");
  } catch (e) {}

  // U1: تحويل نظيف بعد نجاح الربط من auth/salla/callback.js — شريط ترحيب
  // صادق (متجرك مربوط فعلاً وقتها لأن الجلسة نفسها أُنشئت بعد نجاح
  // saveTokens بالخادم)، ونزيل ?connected=1 من الرابط كي لا يبقى الشريط
  // ظاهراً بعد أي تحديث لاحق للصفحة.
  if (new URLSearchParams(location.search).get("connected") === "1") {
    document.getElementById("connectedBanner")?.classList.remove("hidden");
    history.replaceState(null, "", location.pathname);
  }
  loadUsage();
  loadStore();
  // «منتجاتي» هو التبويب الافتراضي — بلا تحميل هنا يفتح قسماً فاضياً بلا
  // شبكة ولا حالة فارغة ولا "جاري التحميل" (رصدها المراجع). الزر معطّل
  // حتى يثبت وجود منتجات.
  setBulkGenerateEnabled(false);
  loadCatalog(0);
  S.reviewLoadedOnce = true;
  loadReview("pending");

  if (inSallaFrame) window.salla?.embedded?.ready?.();
});
