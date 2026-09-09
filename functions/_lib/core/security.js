import { logError } from "./errorLog.js";
// Core Security & Anti-Spam Module for Hala AI OS
// Handles Cloudflare Turnstile bot verification, XSS input sanitization, and security headers.

/**
 * Verifies a Cloudflare Turnstile token with Cloudflare's siteverify API.
 * If TURNSTILE_SECRET_KEY is not set in env (e.g. local dev), passes gracefully.
 */
export async function verifyTurnstileToken(env, token, clientIp = "") {
  const secretKey = env?.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    // Turnstile is a supplementary bot-defense layer only — the real login
    // protection (rate limiting + account lockout in rateLimit.js / db.js) is
    // independent and always on. When the key isn't configured we pass so the
    // flow isn't blocked, but flag it so it's visible this layer is inactive.
    console.warn("[security] TURNSTILE_SECRET_KEY not configured — bot verification layer inactive");
    return { success: true, bypass: true };
  }

  if (!token) {
    return { success: false, error: "Missing Turnstile verification token" };
  }

  try {
    const formData = new URLSearchParams();
    formData.append("secret", secretKey);
    formData.append("response", token);
    if (clientIp) {
      formData.append("remoteip", clientIp);
    }

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData,
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    const data = await res.json();
    if (data?.success) {
      return { success: true };
    }
    return {
      success: false,
      error: data?.["error-codes"]?.[0] ?? "Turnstile verification failed"
    };
  } catch (err) {
    logError({ env }, { requestId: null, path: "core/security.verifyTurnstileToken", code: "TURNSTILE_VERIFY_FAILED", internal: err?.message || String(err) });
    // Allow fallback on temporary network glitch if configured
    return { success: false, error: "Failed to reach verification service" };
  }
}

/**
 * N7 — هل التحقق من Turnstile إلزامي؟
 * لماذا: كان `if (body.turnstileToken)` يترك القرار بيد العميل — أي بوت يحذف
 * الحقل فيتخطى الطبقة كلها. القاعدة الآن: وجود السر = التوكن إلزامي (غيابه 400)،
 * وغياب السر = السلوك القديم (طبقة معطّلة بوضوح، لا كسر للبيئات بلا مفتاح).
 */
export function turnstileRequired(env) {
  return Boolean(env?.TURNSTILE_SECRET_KEY);
}

// Q3 — مصدر واحد لصيغة البريد (كانت مكرّرة بـsignup.js وcomplete_account.js).
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// N2 — حدود جلب الصور من مصدر خارجي (SSRF + استنزاف ذاكرة).
export const MAX_REMOTE_IMAGE_BYTES = 8 * 1024 * 1024;

// مضيفات ممنوعة صراحةً: الشبكة الداخلية وخدمات الميتاداتا السحابية.
const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localhost"];
const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "[::1]", "::1"]);
// IPv4 حرفي أو IPv6 بين قوسين — أي عنوان رقمي يلتف على أي قائمة سماح بالأسماء.
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * N2 — بوابة إلزامية قبل أي `fetch` لعنوان يأتي من مدخل خارجي (جسم طلب، رد
 * مزوّد، كتالوج تاجر). لماذا: `askVisionAI` و`imageProvider` كانا يجلبان أي URL
 * كما هو، فيصير الـWorker وكيل SSRF — يقرأ عناوين داخلية أو يُستنزف بملف ضخم.
 * fail-closed: أي شك = رمي خطأ، لا "تمرير برشاقة".
 */
export function assertPublicHttpsUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new Error("عنوان الصورة غير صالح.");
  }

  // https فقط: http يسمح باعتراض/تحويل، وdata:/file:/blob: تلتف على الفحص كله.
  if (url.protocol !== "https:") {
    throw new Error("عنوان الصورة يجب أن يكون https.");
  }

  // بيانات اعتماد بالـURL تُسرَّب لمزوّد خارجي وتُستخدم لتجاوز محلّلات المضيف.
  if (url.username || url.password) {
    throw new Error("عنوان الصورة يحتوي بيانات اعتماد — مرفوض.");
  }

  const host = url.hostname.toLowerCase();
  if (!host) throw new Error("عنوان الصورة بلا مضيف.");
  if (BLOCKED_HOSTS.has(host)) {
    throw new Error("عنوان الصورة يشير لمضيف داخلي — مرفوض.");
  }
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new Error("عنوان الصورة يشير لمضيف داخلي — مرفوض.");
  }
  // IP حرفي (v4 أو v6): لا سبب مشروع لجلب صورة منتج من رقم مباشر، وهو المسار
  // الأقصر لـ169.254.169.254 و10.x وrfc1918 كلها.
  if (IPV4_RE.test(host) || host.includes(":") || url.hostname.startsWith("[")) {
    throw new Error("عنوان الصورة يشير لعنوان IP مباشر — مرفوض.");
  }

  return url.toString();
}

/**
 * N2 — الجلب الآمن الوحيد للصور الخارجية: يتحقق من العنوان قبل الطلب، ثم من
 * الحجم والنوع بعد الرد. Content-Length المعلن يُرفض فوراً، والحجم الفعلي
 * يُعاد فحصه بعد القراءة (رد بلا Content-Length لا يُعفى من الحد).
 */
export async function fetchExternalImage(rawUrl, { maxBytes = MAX_REMOTE_IMAGE_BYTES } = {}) {
  const safeUrl = assertPublicHttpsUrl(rawUrl);
  // redirect: "error" — تحويل ٣٠٢ لعنوان داخلي يلتف على الفحص أعلاه.
  const res = await fetch(safeUrl, { redirect: "error" });
  if (!res.ok) {
    throw new Error(`تعذر جلب الصورة: HTTP ${res.status}`);
  }

  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("حجم الصورة أكبر من الحد المسموح (8 ميجابايت).");
  }

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new Error("المحتوى المجلوب ليس صورة.");
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new Error("حجم الصورة أكبر من الحد المسموح (8 ميجابايت).");
  }
  return { buffer, contentType };
}

/**
 * Sanitizes input values to prevent XSS, HTML/Script injection, and oversized payloads.
 */
export function sanitizeInput(input, maxLength = 2000) {
  if (input === null || input === undefined) return "";
  
  if (typeof input === "object" && !Array.isArray(input)) {
    const cleanObj = {};
    for (const [key, val] of Object.entries(input)) {
      cleanObj[key] = sanitizeInput(val, maxLength);
    }
    return cleanObj;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeInput(item, maxLength));
  }

  let str = String(input).trim();
  
  // Truncate to max length to prevent payload bloat
  if (str.length > maxLength) {
    str = str.slice(0, maxLength);
  }

  // Strip script tags, event handlers (onerror=, onload=), and javascript: URIs
  str = str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<[^>]+>/g, "") // strip remaining HTML tags
    .replace(/javascript\s*:/gi, "")
    .replace(/on\w+\s*=/gi, "");

  return str;
}

/**
 * Standard security headers for HTTP responses
 */
export function getSecurityHeaders() {
  return {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:;"
  };
}
