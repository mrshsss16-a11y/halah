// Core Security & Anti-Spam Module for Hala AI OS
// Handles Cloudflare Turnstile bot verification, XSS input sanitization, and security headers.

/**
 * Verifies a Cloudflare Turnstile token with Cloudflare's siteverify API.
 * If TURNSTILE_SECRET_KEY is not set in env (e.g. local dev), passes gracefully.
 */
export async function verifyTurnstileToken(env, token, clientIp = "") {
  const secretKey = env?.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    // Development or bypass mode if key is not configured
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
    console.error("[turnstile-error]", err);
    // Allow fallback on temporary network glitch if configured
    return { success: false, error: "Failed to reach verification service" };
  }
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
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:;"
  };
}
