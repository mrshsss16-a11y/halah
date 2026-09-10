// public/js/dashboard/account.js — بوابة إكمال الحساب.
//
// أي استدعاء يرجع code: "ACCOUNT_REQUIRED" (403) معناه: التاجر داخل بجلسة
// سلة سارية لكن بلا حساب عندنا. نلتقط ذلك مركزياً بلف fetch مرة واحدة بدل
// تكرار الفحص بكل نداء. لا مكتبات جديدة.
//
// ملاحظة ترتيب: main.js يستورد هذه الوحدة أولاً، فيُركَّب لفّ fetch قبل أي
// نداء شبكة تطلقه بقية الوحدات — نفس ترتيب النص المضمّن السابق.
//
// وضعان للنافذة (2026-09-10):
//   create — بريد جديد يُنشأ حساباً لصفّ المتجر (`/api/auth/complete_account`)
//   login  — حساب أُنشئ من موقعنا يُربط به المتجر (`/api/auth/claim_store`)
// بدون الوضع الثاني كان صاحب حساب الموقع يصطدم بـ«هذا البريد مسجّل مسبقاً»
// ولا يجد طريقاً لربط متجره بحسابه — رُصد عملياً بتجهيز حساب مراجعة سلة.
import { postCompleteAccount, postClaimStore } from "./api.js";
import { switchTab } from "./tabs.js";

const MODE_TEXT = {
  create: {
    title: "أكمل حسابك",
    submit: "إنشاء الحساب",
    toggle: "عندك حساب بموقعنا؟ سجّل دخول واربط هذا المتجر به",
    password: "كلمة المرور (٨ أحرف على الأقل)"
  },
  login: {
    title: "اربط المتجر بحسابك",
    submit: "دخول وربط المتجر",
    toggle: "ما عندك حساب؟ أنشئ حساباً جديداً",
    password: "كلمة مرور حسابك"
  }
};

let acctMode = "create";

export function setAccountMode(mode) {
  acctMode = MODE_TEXT[mode] ? mode : "create";
  const t = MODE_TEXT[acctMode];
  const set = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };
  set("acctTitle", (el) => { el.innerText = t.title; });
  set("acctSubmit", (el) => { el.innerText = t.submit; });
  set("acctModeToggle", (el) => { el.innerText = t.toggle; });
  set("acctPassword", (el) => { el.placeholder = t.password; });
  set("acctError", (el) => el.classList.add("hidden"));
}

export function toggleAccountMode() {
  setAccountMode(acctMode === "create" ? "login" : "create");
}

export function openAccountModal(msg) {
  const el = document.getElementById("acctModal");
  if (!el) return;
  if (msg) document.getElementById("acctModalMsg").innerText = msg;
  setAccountMode("create");
  el.classList.remove("hidden");
}

export function closeAccountModal() {
  const el = document.getElementById("acctModal");
  if (el) el.classList.add("hidden");
}

export function installAccountGate() {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function (...args) {
    const res = await nativeFetch(...args);
    if (res.status === 403) {
      // clone(): لا نستهلك الجسم — المستدعي الأصلي لازم يقرأه بنفسه.
      const peek = await res.clone().json().catch(() => null);
      if (peek && peek.code === "ACCOUNT_REQUIRED") openAccountModal(peek.error);
    }
    return res;
  };
}

export async function submitCompleteAccount() {
  const btn = document.getElementById("acctSubmit");
  const err = document.getElementById("acctError");
  const email = document.getElementById("acctEmail").value.trim();
  const password = document.getElementById("acctPassword").value;
  const mode = acctMode;
  err.classList.add("hidden");
  btn.disabled = true;
  btn.innerText = mode === "login" ? "جارٍ الربط..." : "جارٍ الإنشاء...";
  try {
    const res = mode === "login" ? await postClaimStore(email, password) : await postCompleteAccount(email, password);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      // البريد له حساب أصلاً ⇒ المقصود غالباً الدخول به، لا إنشاء آخر. ننقل
      // الوضع ونُبقي البريد مكتوباً بدل رسالة تقول «سجّل دخول» بلا طريق.
      if (mode === "create" && res.status === 409 && /مسجّل مسبقاً/.test(data.error || "")) {
        setAccountMode("login");
        err.innerText = "هذا البريد له حساب عندنا — أدخل كلمة مروره ليُربط هذا المتجر به.";
        err.classList.remove("hidden");
        return;
      }
      err.innerText = data.error || "تعذر إكمال العملية. حاول مرة ثانية.";
      err.classList.remove("hidden");
      return;
    }
    closeAccountModal();
    if (mode === "login") {
      // الجلسة استُبدلت بالخادم؛ إعادة التحميل تُحدّث سطر الهوية والحصة بالبريد
      // الجديد بدل عرض «متجر بلا حساب» حتى أول تحديث يدوي.
      window.showToast(`تم ربط المتجر بحساب ${data.email} ✅ — تقدر تدخل بنفس البريد من halah.aura.sa`, "success");
      setTimeout(() => window.location.reload(), 1800);
      return;
    }
    // لا نعيد المحاولة آلياً: الطلب الأصلي قد يكون رفعاً بالجملة أو نشراً،
    // وإعادته بصمت قد تُنفّذ عملية لم يقصدها التاجر الآن.
    window.showToast("تم إنشاء حسابك ✅ — اضغط «اكتب الوصف الآن» لتوليد الوصف.", "success");
    const gb = document.getElementById("genBtn");
    if (gb) { switchTab("studio"); gb.scrollIntoView({ behavior: "smooth", block: "center" }); }
  } catch (e) {
    err.innerText = "تعذر الاتصال. حاول مرة ثانية.";
    err.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.innerText = MODE_TEXT[acctMode].submit;
  }
}
