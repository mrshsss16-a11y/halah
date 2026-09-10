// public/js/dashboard/embedded.js — هالة داخل إطار لوحة سلة: نقطة التماس الوحيدة
// مع Salla Embedded SDK بعد المصادقة.
//
// لماذا (2026-09-10): دليل تصميم التطبيقات المضمّنة يجعل هذي البنود **إلزامية**:
//   - لا شريط تنقّل خاص بالتطبيق ⇒ العنوان يُرسل لشريط سلة (`page.setTitle`)
//   - التطبيق يتبع الوضع الفاتح/الداكن (`onThemeChange`)
//   - أدوات سلة الأصلية للإشعار والتأكيد (`ui.toast` / `ui.confirm`)
// والأخير ليس تجميلاً: `window.confirm` قد يُحجب داخل إطار معزول، فيرجع false
// فوراً ويتعطّل زر «احذف حسابي» و«تراجع» بصمت.
//
// أسماء الدوال وأشكالها مأخوذة من حزمة SDK نفسها المحمَّلة (0.2.6) لا من الذاكرة:
//   init() → { layout: { theme, dir, locale, … } }
//   onThemeChange(cb) → cb(theme) ويرجّع دالة إلغاء الاشتراك
//   ui.toast.success|error|warning|info(message, duration)
//   ui.confirm({ title, message, confirmText, cancelText, variant }) → { confirmed }
//   page.setTitle(nonEmptyString)
//
// كل دالة هنا تعمل خارج الإطار كما كانت (زيارة halah.aura.sa مباشرة) — لا تغيير
// سلوكي هناك.

const TOAST_TYPES = new Set(["success", "error", "warning", "info"]);
const CONFIRM_VARIANTS = new Set(["danger", "warning", "info"]);

/** عناوين التبويبات كما تظهر بشريط لوحة سلة. */
export const TAB_TITLES = { catalog: "منتجاتي ووصفها", store: "متجري" };

let ready = false;
let unsubscribeTheme = null;
let nativeShowToast = null;

function inSallaFrame() {
  try {
    return typeof window !== "undefined" && window.self !== window.top;
  } catch (e) {
    // الوصول لـtop من أصل آخر قد يرمي — وهذا بحد ذاته يعني أننا داخل إطار.
    return true;
  }
}

const sdk = () => (typeof window !== "undefined" && window.salla && window.salla.embedded) || null;
const active = () => ready && inSallaFrame() && !!sdk();

function applyTheme(theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("salla-dark", theme === "dark");
}

/**
 * يُنادى مرة بعد نجاح `embedded.init()`. يطبّق الوضع الحالي ويتبع تغيّره،
 * ويحوّل الإشعارات لأداة سلة.
 */
export function onEmbeddedInit(layout) {
  ready = true;
  applyTheme(layout && layout.theme);
  if (unsubscribeTheme) unsubscribeTheme();
  unsubscribeTheme = null;
  try {
    const unsub = sdk() && sdk().onThemeChange((theme) => applyTheme(theme));
    if (typeof unsub === "function") unsubscribeTheme = unsub;
  } catch (e) { /* SDK أقدم بلا اشتراك الوضع — يبقى الوضع عند قيمته الأولى */ }
  installEmbeddedToast();
}

/** عنوان الصفحة بشريط سلة الأصلي — بديل شريطنا المخفي داخل الإطار. */
export function setEmbeddedTitle(title) {
  if (!active()) return;
  const t = String(title || "").trim();
  if (!t) return;
  try { sdk().page.setTitle("هالة · " + t); } catch (e) { /* العنوان تحسين لا شرط تشغيل */ }
}

function installEmbeddedToast() {
  if (nativeShowToast || typeof window === "undefined") return;
  nativeShowToast = window.showToast || null;
  window.showToast = function (text, type) {
    if (active() && sdk().ui && sdk().ui.toast) {
      const kind = TOAST_TYPES.has(type) ? type : "info";
      try { sdk().ui.toast[kind](String(text || "")); return; } catch (e) { /* يسقط للشريط المحلي */ }
    }
    if (nativeShowToast) nativeShowToast(text, type);
  };
}

/**
 * تأكيد قبل فعل لا رجعة فيه. داخل سلة: نافذة سلة الأصلية. خارجها، أو إن فشل
 * الـSDK: نافذة المتصفح كما كانت. يرجّع true فقط بتأكيد صريح.
 */
export async function confirmAction({ title, message, confirmText, cancelText = "إلغاء", variant = "warning" }) {
  if (active() && sdk().ui && typeof sdk().ui.confirm === "function") {
    try {
      const result = await sdk().ui.confirm({
        title,
        message,
        confirmText,
        cancelText,
        variant: CONFIRM_VARIANTS.has(variant) ? variant : "warning"
      });
      return !!(result && result.confirmed);
    } catch (e) { /* يسقط لنافذة المتصفح */ }
  }
  return typeof window !== "undefined" && typeof window.confirm === "function" ? !!window.confirm(message) : false;
}
