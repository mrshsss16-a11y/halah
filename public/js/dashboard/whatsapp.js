// public/js/dashboard/whatsapp.js — ربط رقم واتساب التاجر (Embedded Signup).
//
// The config ID comes from the server, not hardcoded here: it only exists
// once Meta approves Tech Provider access and a Facebook Login for Business
// configuration is created. Until then the button stays disabled with an
// honest note rather than failing on click.
import { S } from "./state.js";
import { postWaStatus, postWaConnect } from "./api.js";

function waShowError(msg) {
  const el = document.getElementById("waConnError");
  el.classList.remove("hidden");
  el.innerText = msg;
}

export async function loadWaStatus() {
  const badge = document.getElementById("waConnBadge");
  const active = document.getElementById("waConnActive");
  const idle = document.getElementById("waConnIdle");
  try {
    const { data } = await postWaStatus();

    if (data?.connected) {
      badge.className = "shrink-0 text-[11px] font-black px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-800";
      badge.innerText = "مربوط";
      document.getElementById("waConnName").innerText = data.verifiedName || "رقم متجرك";
      document.getElementById("waConnPhone").innerText = data.displayPhone || "";
      active.classList.remove("hidden");
      idle.classList.add("hidden");
      return;
    }

    badge.className = "shrink-0 text-[11px] font-black px-3 py-1.5 rounded-full bg-slate-100 text-slate-700";
    badge.innerText = "غير مربوط";
    active.classList.add("hidden");
    idle.classList.remove("hidden");

    S.waSignupConfigId = data?.configId || null;
    S.waMetaAppId = data?.metaAppId || null;

    const btn = document.getElementById("waConnectBtn");
    const note = document.getElementById("waConnNote");
    if (!data?.available) {
      btn.disabled = true;
      note.innerText = "الربط الذاتي قيد التفعيل مع واتساب — تواصل معنا ونربط رقمك يدوياً الحين.";
    } else {
      btn.disabled = false;
      note.innerText = "تحتاج حساب فيسبوك مرتبط بنشاطك التجاري لإتمام الربط.";
      loadFbSdk();
    }
  } catch (e) {
    badge.innerText = "تعذر الفحص";
  }
}

export function loadFbSdk() {
  if (window.FB || document.getElementById("fbSdkScript")) return;
  window.fbAsyncInit = function () {
    window.FB.init({ appId: S.waMetaAppId, autoLogAppEvents: true, xfbml: true, version: "v21.0" });
  };
  const s = document.createElement("script");
  s.id = "fbSdkScript";
  s.src = "https://connect.facebook.net/en_US/sdk.js";
  s.async = true; s.defer = true; s.crossOrigin = "anonymous";
  document.body.appendChild(s);
}

// Embedded Signup returns the WABA + phone IDs through a postMessage event,
// separately from the auth code that comes back in the FB.login callback —
// both halves are needed, so stash this one until the callback fires.
//
// Exact-match allowlist, not endsWith(): `endsWith('facebook.com')` also
// accepts https://evil-facebook.com and https://notfacebook.com, letting any
// page that can open a window here inject a WABA/phone id (P42/P55).
const WA_SIGNUP_ORIGINS = [
  "https://www.facebook.com",
  "https://web.facebook.com",
  "https://business.facebook.com",
  "https://m.facebook.com",
  "https://facebook.com"
];

export function installWaSignupListener() {
  window.addEventListener("message", (event) => {
    if (!WA_SIGNUP_ORIGINS.includes(event.origin)) return;
    try {
      const data = JSON.parse(event.data);
      if (data.type === "WA_EMBEDDED_SIGNUP" && data.data) {
        S.waSignupSession = { wabaId: data.data.waba_id, phoneNumberId: data.data.phone_number_id };
      }
    } catch (e) {}
  });
}

export function launchWhatsAppSignup() {
  if (!window.FB || !S.waSignupConfigId) {
    waShowError("خدمة الربط لسه تحمّل، حاول بعد ثانية.");
    return;
  }
  window.FB.login((response) => {
    const code = response?.authResponse?.code;
    if (!code) {
      waShowError("تم إلغاء الربط.");
      return;
    }
    finishWhatsAppConnect(code);
  }, {
    config_id: S.waSignupConfigId,
    response_type: "code",
    override_default_response_type: true,
    extras: {
      setup: {},
      // Coexistence: keeps the merchant's existing WhatsApp Business app and
      // chat history working alongside the API instead of replacing it.
      featureType: "whatsapp_business_app_onboarding",
      sessionInfoVersion: "3"
    }
  });
}

export async function finishWhatsAppConnect(code) {
  const btn = document.getElementById("waConnectBtn");
  btn.disabled = true;
  btn.querySelector("span:last-child").innerText = "جاري الربط...";
  try {
    const { data } = await postWaConnect({
      code,
      wabaId: S.waSignupSession?.wabaId,
      phoneNumberId: S.waSignupSession?.phoneNumberId
    });
    if (!data.ok) {
      waShowError(data.error || "تعذر إتمام الربط.");
      return;
    }
    document.getElementById("waConnError").classList.add("hidden");
    loadWaStatus();
  } catch (e) {
    waShowError("تعذر الاتصال بالخادم.");
  } finally {
    btn.disabled = false;
    btn.querySelector("span:last-child").innerText = "ربط واتساب بضغطة واحدة";
  }
}
