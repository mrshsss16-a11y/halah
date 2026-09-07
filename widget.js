/**
 * هالة — سكربت التركيب القابل للتضمين بأي موقع.
 *
 * التركيب: سطر واحد قبل </body> بأي موقع (أورا اليوم، أي متجر لاحقاً):
 *
 *   <script src="https://hala-ai-os.pages.dev/widget.js" data-store-id="hala"></script>
 *
 * data-store-id عام (معرّف، مو سر) — نفس منطق Google Analytics tracking id.
 * التحكم الفعلي بالوصول عبر:
 *   1. قائمة الأصول المسموحة (CORS) بـ functions/_lib/core/cors.js — الموقع
 *      المستضيف لازم يكون مُدرج بـ WIDGET_ALLOWED_ORIGINS، وإلا يرفض المتصفح الطلب.
 *   2. حصة شهرية لكل storeId (functions/api/support.js).
 *
 * Shadow DOM بالكامل — صفر تسريب أو تصادم CSS مع الموقع المضيف. صفر تبعيات
 * خارجية (لا Tailwind، لا خط مستورد) — كل التنسيق مضمّن ومكتفٍ بذاته.
 */
(function () {
  "use strict";

  var thisScript = document.currentScript;
  if (!thisScript) return; // متصفح قديم جداً لا يدعم currentScript — تجاهل بصمت، لا كسر الصفحة

  var API_BASE = new URL(thisScript.src).origin;
  var STORE_ID = thisScript.getAttribute("data-store-id") || "hala";
  var BRAND_LABEL = thisScript.getAttribute("data-label") || "تحدث معنا";

  // المظهر يجي من إعدادات التاجر (/api/widget/config)، لا من كود الموقع
  // المضيف — عشان التاجر يغيّر اللون والترحيب من لوحته بلا ما يلمس HTML
  // موقعه ولا ينتظر أحد. سمات السكربت تبقى كتجاوز اختياري.
  var GREETING = thisScript.getAttribute("data-greeting") || "هلا والله 👋 وش تبي تعرف؟";
  var PRIMARY = thisScript.getAttribute("data-color") || "#0f172a";
  var AGENT_NAME = "هالة";

  // localStorage لا session جديد بكل صفحة داخل نفس الموقع — يحافظ على تاريخ
  // المحادثة أثناء تنقل الزائر بين صفحات نفس الموقع بجلسة واحدة.
  var STORAGE_KEY = "hala_widget_history_" + STORE_ID;
  var history = [];
  try {
    var saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) history = JSON.parse(saved).slice(-16);
  } catch (e) {
    /* التخزين محجوب (خصوصية/متصفح خاص) — تجاهل، ابدأ محادثة جديدة */
  }

  function persistHistory() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-16)));
    } catch (e) {
      /* تجاهل — التخزين ليس حرجاً لعمل الودجت */
    }
  }

  var host = document.createElement("div");
  host.id = "hala-widget-host";
  host.style.all = "initial"; // يعزل الجذر عن أي CSS بالصفحة المضيفة قبل Shadow DOM حتى
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: "open" });

  root.innerHTML =
    '<style>' +
    ':host{all:initial}' +
    '*{box-sizing:border-box;font-family:"Tahoma","Segoe UI",Arial,sans-serif}' +
    '.launcher{position:fixed;bottom:24px;left:24px;z-index:2147483000;width:56px;height:56px;' +
    'border-radius:50%;background:#0f172a;color:#fff;border:none;cursor:pointer;' +
    'box-shadow:0 10px 25px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;' +
    'font-size:26px;transition:transform .15s ease}' +
    '.launcher:hover{transform:scale(1.06)}' +
    '.panel{position:fixed;bottom:92px;left:24px;z-index:2147483000;width:min(92vw,360px);' +
    'height:min(70vh,520px);background:#fff;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.3);' +
    'border:1px solid #e2e8f0;display:flex;flex-direction:column;overflow:hidden;direction:rtl;' +
    'opacity:0;transform:scale(.95);pointer-events:none;transition:opacity .15s ease,transform .15s ease}' +
    '.panel.open{opacity:1;transform:scale(1);pointer-events:auto}' +
    '.head{background:#0f172a;color:#fff;padding:14px 16px;font-weight:700;font-size:14px}' +
    '.msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#f8fafc}' +
    '.bubble{max-width:85%;padding:9px 13px;border-radius:14px;line-height:1.6;font-size:13.5px;white-space:pre-wrap}' +
    '.bubble.user{align-self:flex-end;background:#0f172a;color:#fff;border-bottom-left-radius:4px}' +
    '.bubble.bot{align-self:flex-start;background:#fff;color:#1e293b;border:1px solid #e2e8f0;border-bottom-right-radius:4px}' +
    '.wa{align-self:flex-start;background:#dcfce7;color:#166534;border:1px solid #86efac;border-radius:12px;' +
    'padding:8px 12px;font-size:12.5px;text-decoration:none;font-weight:700}' +
    '.foot{padding:10px;border-top:1px solid #e2e8f0;display:flex;gap:8px;background:#fff}' +
    '.foot input{flex:1;border:1px solid #cbd5e1;border-radius:10px;padding:9px 11px;font-size:13px;outline:none}' +
    '.foot input:focus{border-color:#0f172a}' +
    '.foot button{background:#0f172a;color:#fff;border:none;border-radius:10px;padding:0 14px;cursor:pointer;font-size:13px}' +
    '.foot button:disabled{opacity:.5;cursor:default}' +
    '@media(max-width:420px){.panel{left:12px;right:12px;width:auto;bottom:84px}.launcher{left:16px}}' +
    "</style>" +
    '<button class="launcher" type="button" aria-label="' + BRAND_LABEL + '">💬</button>' +
    '<div class="panel">' +
    '<div class="head">هالة — مساعدتك الرقمية</div>' +
    '<div class="msgs"></div>' +
    '<div class="foot"><input type="text" placeholder="اكتب رسالتك…" /><button type="button">إرسال</button></div>' +
    "</div>";

  var launcher = root.querySelector(".launcher");
  var panel = root.querySelector(".panel");
  var head = root.querySelector(".head");
  var msgsEl = root.querySelector(".msgs");
  var input = root.querySelector("input");
  var sendBtn = root.querySelector(".foot button");
  var opened = false;

  // تطبيق اللون الأولي (من سمة السكربت لو وُجدت) قبل وصول الإعدادات
  launcher.style.background = PRIMARY;
  head.style.background = PRIMARY;
  sendBtn.style.background = PRIMARY;

  function addBubble(role, text) {
    var el = document.createElement("div");
    el.className = "bubble " + (role === "user" ? "user" : "bot");
    el.textContent = text;
    msgsEl.appendChild(el);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return el;
  }

  function addWhatsappLink(url) {
    var a = document.createElement("a");
    a.className = "wa";
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "↩ تكمل الحديث على واتساب";
    msgsEl.appendChild(a);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  // إعادة رسم أي محادثة محفوظة سابقاً عند فتح الودجت أول مرة بهذه الصفحة.
  history.forEach(function (m) {
    addBubble(m.role, m.content);
  });

  function toggle() {
    opened = !opened;
    panel.classList.toggle("open", opened);
    if (opened) {
      if (!history.length) addBubble("assistant", GREETING);
      input.focus();
    }
  }

  launcher.addEventListener("click", toggle);

  function send() {
    var text = input.value.trim();
    if (!text) return;

    addBubble("user", text);
    history.push({ role: "user", content: text });
    persistHistory();
    input.value = "";
    input.disabled = true;
    sendBtn.disabled = true;

    var typing = addBubble("bot", "…");

    fetch(API_BASE + "/api/support", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history, storeId: STORE_ID })
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        var reply = (data && (data.reply || data.error)) || "تعذر الرد الآن، حاول مرة ثانية.";
        typing.textContent = reply;
        if (data && data.reply) {
          history.push({ role: "assistant", content: data.reply });
          persistHistory();
        }
        if (data && data.whatsappCta && data.whatsappUrl) {
          addWhatsappLink(data.whatsappUrl);
        }
      })
      .catch(function () {
        typing.textContent = "تعذر الاتصال الآن — تحقق من اتصالك بالإنترنت وحاول مرة ثانية.";
      })
      .finally(function () {
        input.disabled = false;
        sendBtn.disabled = false;
        input.focus();
      });
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") send();
  });

  // جلب المظهر بعد الرسم الأول: الودجت يظهر فوراً بالقيم الافتراضية ثم يتلوّن،
  // بدل ما ينتظر الشبكة ويبان متأخراً — وفشل الجلب لا يخفيه.
  fetch(API_BASE + "/api/widget/config?storeId=" + encodeURIComponent(STORE_ID))
    .then(function (r) {
      return r.json();
    })
    .then(function (cfg) {
      if (!cfg) return;
      if (cfg.enabled === false) {
        host.remove();
        return;
      }
      if (cfg.primaryColor) {
        PRIMARY = cfg.primaryColor;
        launcher.style.background = PRIMARY;
        head.style.background = PRIMARY;
        sendBtn.style.background = PRIMARY;
      }
      if (cfg.position === "right") {
        launcher.style.left = "auto";
        launcher.style.right = "24px";
        panel.style.left = "auto";
        panel.style.right = "24px";
      }
      if (cfg.agentName) {
        AGENT_NAME = cfg.agentName;
        head.textContent = AGENT_NAME + (cfg.businessName ? " — " + cfg.businessName : "");
      }
      // الترحيب يُحدَّث فقط لو المحادثة ما بدأت بعد
      if (cfg.greeting && !history.length) GREETING = cfg.greeting;
    })
    .catch(function () {
      /* الإعدادات تعذّرت — نكمل بالافتراضي، لا نُخفي الودجت */
    });
})();
