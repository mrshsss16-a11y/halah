// public/js/dashboard/agent.js — إعدادات وكيل خدمة عملاء المتجر وتجربته.
import { S } from "./state.js";
import { postAgentContextGet, postAgentContextSave, postChat } from "./api.js";
import { appendChat } from "./render.js";
import { loadUsage } from "./store.js";

const showMsg = (id, text, type) => window.showMsg(id, text, type);
const LOAD_FAIL = "ما قدرنا نجيب إعداداتك المحفوظة — لا تحفظ شي الحين لين يرجع الاتصال، عشان ما تكتب فوق تعليماتك الأصلية.";
const SAVE_FAIL = "ما قدرنا نحفظ التعليمات — تأكد من الإنترنت وحاول مرة ثانية. تعليماتك القديمة لسه فعّالة.";

export async function loadAgentContext() {
  try {
    const { res, data } = await postAgentContextGet();
    if (!res.ok) { showMsg("agentFeedback", LOAD_FAIL, "error"); return; }
    if (data?.dialect) document.getElementById("agentDialect").value = data.dialect;
    if (data?.instructions) document.getElementById("agentInstructions").value = data.instructions;
  } catch (e) {
    showMsg("agentFeedback", LOAD_FAIL, "error");
  }
}

export async function saveAgentContext() {
  try {
    const { res, data } = await postAgentContextSave(
      document.getElementById("agentDialect").value,
      document.getElementById("agentInstructions").value
    );
    // خطأ خادم بلا حقل error كان يُعرض "تم الحفظ ✅" — نجاح كاذب.
    if (!res.ok || data?.error) {
      showMsg("agentFeedback", data?.error || SAVE_FAIL, "error");
    } else {
      showMsg("agentFeedback", "تم الحفظ والتطبيق ✅", "success");
    }
  } catch (e) {
    showMsg("agentFeedback", SAVE_FAIL, "error");
  }
}

export async function sendChat() {
  const input = document.getElementById("chatInput");
  const msg = input.value.trim();
  if (!msg) return;
  appendChat("user", msg);
  input.value = "";
  S.chatHistory.push({ role: "user", content: msg });

  try {
    const { data } = await postChat(S.chatHistory.slice(-8));
    const reply = data?.reply || data?.result || data?.error || "لا يوجد رد.";
    appendChat("bot", reply);
    if (data?.reply || data?.result) S.chatHistory.push({ role: "assistant", content: reply });
    loadUsage();
  } catch (e) {
    appendChat("bot", "تعذر الاتصال.");
  }
}
