// public/js/admin/aurawa.js — أيجنت واتساب أورا: إعداد المفاتيح، تدريب RAG،
// محاكي الردود الحي، ومختبر الميزات — كلها على /api/admin/aura_whatsapp.
import { auraWa } from "./api.js";

const esc = (v) => window.escHtml(v);

export async function loadAuraWaConfig() {
  try {
    const data = await auraWa("get_config");
    if (data?.ok) {
      document.getElementById("waPhoneId").innerText = data.whatsapp.phoneId;
      document.getElementById("waVerifyToken").innerText = data.whatsapp.verifyToken || (data.whatsapp.hasVerifyToken ? "مربوط ومحمي 🔒" : "غير مخصص");
    }
  } catch (err) {
    console.error("Failed to load Aura WhatsApp config:", err);
  }
}

export async function handleTrainAuraAgent(e) {
  e.preventDefault();
  const q = document.getElementById("trainQuestion").value.trim();
  const a = document.getElementById("trainAnswer").value.trim();

  try {
    const data = await auraWa("update_agent", { question: q, answer: a });
    if (data?.ok) {
      alert("تمت إضافة المعلومة لذاكرة RAG لأيجنت أورا بنجاح! 🎉");
      document.getElementById("trainQuestion").value = "";
      document.getElementById("trainAnswer").value = "";
    }
  } catch (err) {
    alert("حدث خطأ في الحفظ.");
  }
}

export async function handleTestAuraAgentMsg(e) {
  e.preventDefault();
  const input = document.getElementById("waTestInput");
  const text = input.value.trim();
  if (!text) return;

  const stream = document.getElementById("waChatStream");
  stream.innerHTML += `
    <div class="flex justify-end">
      <div class="bg-black text-white p-2.5 rounded-xl max-w-[85%] font-medium shadow-sm">
        ${esc(text)}
      </div>
    </div>
  `;
  input.value = "";
  stream.scrollTop = stream.scrollHeight;

  try {
    const data = await auraWa("test_agent", { message: text });

    const reply = data?.agentReply || "أهلاً بك في أورا للتسويق!";
    const latency = data?.latencyMs || "AI";

    stream.innerHTML += `
      <div class="flex items-start gap-2">
        <div class="bg-white border border-slate-300 text-black p-2.5 rounded-xl max-w-[85%] leading-relaxed shadow-sm font-medium">
          ${esc(reply)}
          <span class="block text-[9px] text-slate-500 font-mono mt-1">سرعة الرد: ${esc(latency)} (${esc(data?.source)})</span>
        </div>
      </div>
    `;
    stream.scrollTop = stream.scrollHeight;
  } catch (err) {
    console.error("Test error:", err);
  }
}

export async function handleSaveWaCredentials(e) {
  e.preventDefault();
  const token = document.getElementById("inputWaToken")?.value?.trim();
  const phoneId = document.getElementById("inputWaPhoneId")?.value?.trim();

  if (!token || !phoneId) return;

  try {
    const data = await auraWa("save_credentials", { token, phoneId });
    if (data?.ok) {
      alert("🎉 " + (data.message || "تم حفظ وتفعيل الواتساب بنجاح!"));
      // ⚠️ دَين قائم قبل المرحلة ٥ ومنقول كما هو (تقسيم بلا تغيير سلوكي):
      // `loadAuraWhatsappData` غير معرَّفة بأي مكان — النداء يرمي ReferenceError
      // فيقع بـcatch أدناه ويظهر تنبيه "تعذر حفظ المفاتيح" بعد تنبيه النجاح.
      // إصلاحه تغيير سلوكي يخص مالك الملف، لا هذه المرحلة.
      loadAuraWhatsappData();
    }
  } catch (err) {
    alert("تعذر حفظ المفاتيح.");
  }
}

export async function runFeatureTest(feature) {
  const consoleEl = document.getElementById("testerConsole");
  const testInput = document.getElementById("intentTestInput")?.value || "";
  consoleEl.innerText = `جاري تشغيل الفحص للميزة (${feature})... ⏳`;

  try {
    const data = await auraWa("test_feature", { feature, input: testInput });
    consoleEl.innerText = JSON.stringify(data, null, 2);
  } catch (err) {
    consoleEl.innerText = "حدث خطأ في تشغيل الفحص المختبري.";
  }
}
