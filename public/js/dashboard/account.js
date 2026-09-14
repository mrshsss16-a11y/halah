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
import { postCompleteAccount, postClaimStore, postSallaGoogle, postGoogleLinkStart } from "./api.js";
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
const inSallaFrame = window.self !== window.top;

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
  // داخل إطار سلة: زر النافذة المستقلة (زر جوجل المضمَّن لم يظهر لتاجر حقيقي). خارجه: زر جوجل الرسمي.
  document.getElementById("acctGooglePopupBlock")?.classList.toggle("hidden", !inSallaFrame);
  if (!inSallaFrame) renderAccountGoogle();
}

/** زر «أكمل بجوجل» بالشريط: داخل سلة يفتح نافذة الدخول مباشرة، وخارجها نافذة إكمال الحساب. */
export function completeWithGoogle() {
  if (inSallaFrame) startGoogleLink();
  else openAccountModal();
}

// نافذة الدخول بجوجل المستقلة (2026-09-14): الإطار يصدر رمزاً لمرة واحدة بجلسته، والنافذة (/google-link)
// تقدّمه مع رد جوجل. نعرف النجاح برسالة من النافذة (أصل مطابق تماماً) أو بعودة التركيز والتحقق من /api/auth/me.
let awaitingGoogle = false;
export async function startGoogleLink() {
  const err = document.getElementById("acctError");
  err?.classList.add("hidden");
  try {
    const res = await postGoogleLinkStart();
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || "");
    const w = window.open(data.url, "hala_google", "width=480,height=640");
    awaitingGoogle = true;
    if (!w) {
      openAccountModal();
      const target = document.getElementById("acctError");
      if (target) {
        target.textContent = "المتصفح منع نافذة جوجل. ";
        const a = document.createElement("a");
        a.href = data.url; a.target = "_blank"; a.rel = "noopener"; a.className = "underline font-bold";
        a.textContent = "افتح نافذة الدخول بجوجل";
        target.appendChild(a);
        target.classList.remove("hidden");
      }
    }
  } catch (e) {
    window.showToast?.(e?.message || "تعذر بدء الدخول بجوجل. حاول مرة ثانية.", "error");
  }
}

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin || event.data?.type !== "hala-google-linked") return;
  window.location.reload();
});

window.addEventListener("focus", async () => {
  if (!awaitingGoogle) return;
  const me = await fetch("/api/auth/me", { method: "POST" }).then((r) => r.json()).catch(() => null);
  // حساب جديد ⇒ بريد ظاهر. ربط بحساب جوجل قائم ⇒ نسخة الجلسة تغيّرت فتسقط — إعادة التحميل تنشئ جلسة سلة جديدة.
  if (me?.email || me?.loggedIn === false) { awaitingGoogle = false; window.location.reload(); }
});

// «أكمل بجوجل» (طلب المالك 2026-09-14): أبسط من بريد وكلمة مرور. زر جوجل الرسمي بنافذة منبثقة
// (use_fedcm_for_button: false) — FedCM داخل إطار سلة يحتاج إذناً على وسم iframe الخاص بهم لا نملكه.
let googleReady = false;
async function renderAccountGoogle() {
  const wrap = document.getElementById("acctGoogleWrap");
  if (!wrap || googleReady) return;
  try {
    const cfg = await (await fetch("/api/auth/google_client", { cache: "no-store" })).json();
    if (!cfg?.clientId) return;
    await loadGsi();
    window.google.accounts.id.initialize({ client_id: cfg.clientId, callback: onAccountGoogle, use_fedcm_for_button: false });
    document.getElementById("acctGoogleBlock")?.classList.remove("hidden");
    window.google.accounts.id.renderButton(wrap, { type: "standard", theme: "outline", size: "large", shape: "pill", text: "continue_with", locale: "ar", width: Math.min(320, wrap.clientWidth || 300) });
    googleReady = true;
  } catch (e) { /* بلا زر جوجل تبقى الطريقة بالبريد وكلمة المرور */ }
}

function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = "https://accounts.google.com/gsi/client";
    sc.async = true;
    sc.onload = () => resolve();
    sc.onerror = () => reject(new Error("gsi"));
    document.head.appendChild(sc);
  });
}

async function onAccountGoogle(response) {
  const err = document.getElementById("acctError");
  err?.classList.add("hidden");
  try {
    const res = await postSallaGoogle(response?.credential || "");
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      if (data.code === "PASSWORD_ACCOUNT_EXISTS") setAccountMode("login");
      if (err) { err.innerText = data.error || "تعذر الدخول بجوجل. حاول مرة ثانية."; err.classList.remove("hidden"); }
      return;
    }
    closeAccountModal();
    window.showToast(data.linked ? `تم ربط المتجر بحساب ${data.email} ✅` : `تم إنشاء حسابك بـ ${data.email} ✅`, "success");
    setTimeout(() => window.location.reload(), 1500);
  } catch (e) {
    if (err) { err.innerText = "تعذر الاتصال. حاول مرة ثانية."; err.classList.remove("hidden"); }
  }
}

export function closeAccountModal() {
  const el = document.getElementById("acctModal");
  if (el) el.classList.add("hidden");
}

// جلسة ضاعت داخل إطار سلة (2026-09-10). رُصد: تاجر يضغط منتجاً فلا يحدث
// «شي»، والخادم لم يرَ أي نشاط بجلسة لساعة ونصف. بلا جلسة يرد `/api/copy`
// بـ401 LOGIN_REQUIRED لا 403، فلا تفتح نافذة الحساب، ورسالة الخطأ تُكتب تحت
// الشبكة بعيداً عن الضغطة. داخل الإطار لا يوجد مخرج «سجّل دخول» (login.html
// يرفض التأطير)، فالمخرج الوحيد الصادق: أعد تحميل هالة لتُنشأ جلسة جديدة.
let frameSessionToastAt = 0;
function notifyFrameSessionLost() {
  if (Date.now() - frameSessionToastAt < 30000) return; // مرة كل ٣٠ث — لا سيل إشعارات
  frameSessionToastAt = Date.now();
  window.showToast?.(
    "انقطعت جلستك داخل سلة — أعد تحميل صفحة هالة. لو تكرر: لا تستخدم التصفح الخفي، واسمح بملفات تعريف الارتباط لـ halah.aura.sa.",
    "error"
  );
}

export function installAccountGate() {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function (...args) {
    const res = await nativeFetch(...args);
    if (res.status === 403 || (res.status === 401 && inSallaFrame)) {
      // clone(): لا نستهلك الجسم — المستدعي الأصلي لازم يقرأه بنفسه.
      const peek = await res.clone().json().catch(() => null);
      if (peek && peek.code === "ACCOUNT_REQUIRED") openAccountModal(peek.error);
      if (peek && peek.code === "LOGIN_REQUIRED" && inSallaFrame) notifyFrameSessionLost();
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
    // الزر داخل «studioManual» المطويّ: بلا فتحه يُمرَّر لعنصر مخفي (جولة الجاهزية 2026-09-13).
    if (gb) { switchTab("studio"); const manual = document.getElementById("studioManual"); if (manual) manual.open = true; gb.scrollIntoView({ behavior: "smooth", block: "center" }); }
  } catch (e) {
    err.innerText = "تعذر الاتصال. حاول مرة ثانية.";
    err.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.innerText = MODE_TEXT[acctMode].submit;
  }
}
