// public/js/dashboard/account.js — بوابة إكمال الحساب.
//
// أي استدعاء يرجع code: "ACCOUNT_REQUIRED" (403) معناه: التاجر داخل بجلسة
// سلة سارية لكن بلا حساب عندنا. نلتقط ذلك مركزياً بلف fetch مرة واحدة بدل
// تكرار الفحص بكل نداء. لا مكتبات جديدة.
//
// ملاحظة ترتيب: main.js يستورد هذه الوحدة أولاً، فيُركَّب لفّ fetch قبل أي
// نداء شبكة تطلقه بقية الوحدات — نفس ترتيب النص المضمّن السابق.
import { postCompleteAccount } from "./api.js";
import { switchTab } from "./tabs.js";

export function openAccountModal(msg) {
  const el = document.getElementById("acctModal");
  if (!el) return;
  if (msg) document.getElementById("acctModalMsg").innerText = msg;
  document.getElementById("acctError").classList.add("hidden");
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
  err.classList.add("hidden");
  btn.disabled = true;
  btn.innerText = "جارٍ الإنشاء...";
  try {
    const res = await postCompleteAccount(email, password);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      err.innerText = data.error || "تعذر إنشاء الحساب. حاول مرة ثانية.";
      err.classList.remove("hidden");
      return;
    }
    closeAccountModal();
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
    btn.innerText = "إنشاء الحساب";
  }
}
