// Real AI product-photo generation: preserves the merchant's actual product
// (not a generic AI-invented one) by passing it as a reference image to an
// image-editing model, instead of text-to-image from scratch.
//
// Primary: Cloudflare Workers AI `flux-2-klein-4b` — free within the shared
// daily Workers AI neuron allocation, no external key. Live-verified (see
// project plan notes) via the raw management API: product identity (shape,
// engravings, handle) preserved exactly, new background/lighting applied,
// ~6s. Reference images must be ≤512x512 (documented constraint) — caller
// resizes before calling this module.
//
// Fallback: Hugging Face Inference Providers → fal-ai `flux-kontext-dev`.
// Live-verified endpoint/payload shape (see plan). Only used when klein
// fails AND env.HF_TOKEN is configured — optional, the whole feature works
// without it. Free monthly credit is tiny (~$0.10 ≈ 3-4 images), so this is
// a rare bonus attempt, not a real capacity extension — never advertised to
// merchants as "extra daily images".
// N2 — تنزيل صورة المزوّد الاحتياطي يمر ببوابة SSRF/الحجم نفسها.
import { fetchExternalImage } from "./core/security.js";

const KLEIN_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
const HF_ENDPOINT = "https://router.huggingface.co/fal-ai/fal-ai/flux-kontext/dev";

// "طابع العميل" style presets — English prompts (models follow English more
// precisely for photography direction); Arabic labels shown in the UI.
export const STYLE_PRESETS = {
  "luxury-dark": {
    label: "فخم داكن",
    prompt:
      "place this exact product on a dark charcoal surface with dramatic warm side lighting, deep shadows, subtle reflection, premium luxury product photography, keep the product completely unchanged"
  },
  "minimal-white": {
    label: "أبيض مينيمال",
    prompt:
      "place this exact product on a clean seamless white studio background with soft even lighting, minimal shadow, e-commerce catalog product photography, keep the product completely unchanged"
  },
  "warm-heritage": {
    label: "دافئ تراثي",
    prompt:
      "place this exact product on a warm wooden or woven textile surface with golden hour lighting, cozy traditional Arabian heritage atmosphere, keep the product completely unchanged"
  },
  "bold-modern": {
    label: "عصري جريء",
    prompt:
      "place this exact product against a bold colored gradient background with sharp modern studio lighting and strong contrast, contemporary editorial product photography, keep the product completely unchanged"
  },
  "marble-luxury": {
    label: "رخام فاخر",
    prompt:
      "place this exact product on a polished luxury marble surface with soft studio lighting and a subtle reflection, high-end boutique product photography, keep the product completely unchanged"
  },
  "outdoor-natural": {
    label: "طبيعي خارجي",
    prompt:
      "place this exact product on a natural outdoor surface with soft daylight, warm sky tones in the background, lifestyle product photography, keep the product completely unchanged"
  }
};

function base64ToBytes(base64) {
  const binString = atob(base64);
  const bytes = new Uint8Array(binString.length);
  for (let i = 0; i < binString.length; i++) bytes[i] = binString.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function tryKlein({ env, imageBase64, mime, prompt }) {
  const bytes = base64ToBytes(imageBase64);
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("input_image_0", new Blob([bytes], { type: mime }), "product.png");

  // Two live-caught fixes here:
  // 1. contentType must include the real multipart boundary FormData
  //    generated — the literal string "multipart/form-data" alone caused
  //    "3030: Missing boundary in multipart." on every call.
  // 2. Per Cloudflare's own docs ("FormData is serialized into a stream
  //    before passing"), `multipart.body` must be the serialized byte
  //    stream, not the FormData object itself — passing the FormData
  //    directly caused "8001: Invalid input" on every call.
  const probe = new Request("https://x", { method: "POST", body: form });
  const contentType = probe.headers.get("content-type");
  const bodyStream = probe.body;

  const response = await env.AI.run(KLEIN_MODEL, {
    multipart: { body: bodyStream, contentType }
  });

  const outB64 = response && response.image;
  if (!outB64) throw new Error("klein returned no image");
  return { imageBase64: outB64, mime: "image/png", provider: "klein" };
}

async function tryHuggingFace({ env, imageBase64, mime, prompt }) {
  if (!env.HF_TOKEN) throw new Error("HF_TOKEN not configured");

  const res = await fetch(HF_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.HF_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, image_url: `data:${mime};base64,${imageBase64}` })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`hf-kontext HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const url = data && data.images && data.images[0] && data.images[0].url;
  if (!url) throw new Error("hf-kontext returned no image url");

  // العنوان يأتي من رد مزوّد خارجي — يُعامَل كمدخل غير موثوق: https فقط، بلا
  // مضيف داخلي أو IP حرفي، وبحد ٨ ميجابايت ونوع صورة فعلي.
  const { buffer, contentType } = await fetchExternalImage(url);
  const buf = new Uint8Array(buffer);
  return { imageBase64: bytesToBase64(buf), mime: (contentType || "image/jpeg").split(";")[0].trim(), provider: "huggingface" };
}

/**
 * @param {object} opts
 * @param {any} opts.env
 * @param {string} opts.imageBase64 - raw base64 (no data: prefix), ≤512x512
 * @param {string} opts.mime
 * @param {string} opts.prompt
 * @returns {Promise<{imageBase64: string, mime: string, provider: "klein"|"huggingface"}>}
 */
export async function generateProductImage({ env, imageBase64, mime, prompt }) {
  try {
    return await tryKlein({ env, imageBase64, mime, prompt });
  } catch (kleinErr) {
    try {
      return await tryHuggingFace({ env, imageBase64, mime, prompt });
    } catch (hfErr) {
      throw new Error(
        `تعذر توليد الصورة: خدمة Cloudflare مشغولة أو خلص الرصيد اليومي (${kleinErr.message}), ` +
          `والمزود الاحتياطي غير متاح أو خلص رصيده (${hfErr.message}).`
      );
    }
  }
}
