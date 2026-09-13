// public/js/dashboard/brandVoice.js — «لهجة متجري» (طلب المالك 2026-09-13): نافذة يصف فيها التاجر أسلوب براندته أو
// يلصق نموذجاً من محتواه، وتُحفظ على الخادم (/api/store/voice). نبرة «لهجة متجري» بلا لهجة محفوظة تفتح النافذة بدل
// توليد صامت بنبرة أخرى.
import { postBrandVoice } from "./api.js";

const $ = (id) => document.getElementById(id);
const showMsg = (id, text, type) => window.showMsg(id, text, type);
let saved = null;

function paint() {
  const state = $("brandVoiceState");
  if (state) state.innerText = saved ? `محفوظة${saved.name ? ": " + saved.name : ""}` : "";
}

export async function loadBrandVoice() {
  try {
    const { data } = await postBrandVoice("get");
    saved = data?.ok ? data.voice : null;
  } catch (e) {
    saved = null;
  }
  paint();
  return saved;
}

export async function openBrandVoice() {
  $("brandVoiceModal")?.classList.remove("hidden");
  $("bvFeedback")?.classList.add("hidden");
  const v = saved || (await loadBrandVoice());
  $("bvName").value = v?.name || "";
  $("bvNotes").value = v?.notes || "";
  $("bvSample").value = v?.sample || "";
  $("bvLikes").value = (v?.likes || []).join("، ");
  $("bvAvoids").value = (v?.avoids || []).join("، ");
  $("bvNotes").focus();
}

export function closeBrandVoice() {
  $("brandVoiceModal")?.classList.add("hidden");
  const tone = $("pTone");
  if (tone && tone.value === "brand" && !saved) tone.value = "white";
}

export async function saveBrandVoice() {
  const btn = $("bvSave");
  btn.disabled = true;
  try {
    const voice = { name: $("bvName").value, notes: $("bvNotes").value, sample: $("bvSample").value, likes: $("bvLikes").value, avoids: $("bvAvoids").value };
    const { data } = await postBrandVoice("save", voice);
    if (!data?.ok) { showMsg("bvFeedback", data?.error || "تعذر الحفظ.", "error"); return; }
    saved = data.voice;
    paint();
    const tone = $("pTone");
    if (tone) tone.value = "brand";
    showMsg("bvFeedback", data.message || "حُفظت لهجة متجرك.", "success");
    setTimeout(() => $("brandVoiceModal")?.classList.add("hidden"), 1200);
  } catch (e) {
    showMsg("bvFeedback", "تعذر الاتصال.", "error");
  } finally {
    btn.disabled = false;
  }
}

/** اختيار «لهجة متجري» بلا لهجة محفوظة يفتح نافذة الإعداد. */
export async function onToneChange() {
  const tone = $("pTone");
  if (tone?.value !== "brand") return;
  if (!(saved || (await loadBrandVoice()))) openBrandVoice();
}
