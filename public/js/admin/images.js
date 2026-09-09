// public/js/admin/images.js — توليد صور المنتجات (بيتا مغلقة على حساب الأدمن).
//
// /api/image expects raw base64 of an image already <=512x512 (Workers AI
// reference-image limit), so the downscale happens here before upload.
import { generateImage } from "./api.js";

let productImageBase64 = null;
let productImageMime = "image/png";

export function previewProductImage(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 512;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL("image/png");
      productImageMime = "image/png";
      productImageBase64 = dataUrl.split(",")[1];

      const before = document.getElementById("imgBefore");
      before.src = dataUrl;
      before.classList.remove("hidden");
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

export async function generateProductImageAdmin() {
  const feedback = document.getElementById("imgFeedback");
  const btn = document.getElementById("imgBtn");
  const btnText = document.getElementById("imgBtnText");

  if (!productImageBase64) {
    feedback.classList.remove("hidden");
    feedback.innerText = "اختر صورة المنتج أولاً.";
    return;
  }

  btn.disabled = true;
  btnText.innerText = "جاري التوليد… ⚡";
  feedback.classList.add("hidden");

  try {
    const data = await generateImage({
      imageBase64: productImageBase64,
      mime: productImageMime,
      style: document.getElementById("imgStyle").value
    });

    if (data?.ok && data?.imageBase64) {
      const out = `data:${data.mime || "image/png"};base64,${data.imageBase64}`;
      const after = document.getElementById("imgAfter");
      after.src = out;
      after.classList.remove("hidden");
      const dl = document.getElementById("imgDownload");
      dl.href = out;
      dl.classList.remove("hidden");
      feedback.classList.remove("hidden");
      feedback.innerText = `تم التوليد عبر ${data.provider || "المزود"} — المتبقي اليوم: ${data.remaining ?? "—"}`;
    } else {
      feedback.classList.remove("hidden");
      feedback.innerText = data?.error || "تعذر توليد الصورة.";
    }
  } catch (err) {
    feedback.classList.remove("hidden");
    feedback.innerText = "تعذر الاتصال بالخادم.";
  }

  btn.disabled = false;
  btnText.innerText = "ولّد الصورة";
}
