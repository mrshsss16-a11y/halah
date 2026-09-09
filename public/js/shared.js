// public/js/shared.js — دوال مشتركة بين صفحات الجذر (dashboard/admin/login وغيرها).
// نُسخ حرفياً إلى dist/js/shared.js عبر scripts/stage.mjs. حمّله بـ<script> قبل
// سكربت الصفحة نفسه. لا يعتمد على أي مكتبة خارجية.
(function (global) {
  "use strict";

  // يهرّب أي نص قادم من API أو من بيانات تاجر/عميل قبل حقنه بـinnerHTML —
  // منتجات سلة، أسماء واتساب، مراجع الطلبات كلها مصدر محتمل لـXSS مخزّن.
  // صالح أيضاً لقيم داخل خصائص HTML المقتبَسة (يهرّب كلا نوعي الأقواس).
  function escHtml(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  const MSG_STYLES = {
    error: "bg-rose-50 text-rose-800 border-rose-300",
    success: "bg-emerald-50 text-emerald-800 border-emerald-300",
    info: "bg-slate-100 text-black border-black"
  };

  // يعرض رسالة داخل عنصر ثابت بالصفحة (id معطى) — للحقول والنماذج.
  function showMsg(id, text, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("hidden");
    el.innerText = text;
    el.className = "p-3.5 rounded-xl text-xs font-bold border " + (MSG_STYLES[type] || MSG_STYLES.info);
  }

  let toastTimer = null;
  // إشعار عائم مؤقت — يتطلب عنصراً بـid="globalToast" بالصفحة.
  function showToast(text, type) {
    const el = document.getElementById("globalToast");
    if (!el) return;
    const base = "fixed top-4 left-1/2 -translate-x-1/2 z-[100] max-w-md w-[92vw] p-3.5 rounded-xl text-xs font-bold border shadow-lg flex items-start gap-2 ";
    el.className = base + (MSG_STYLES[type] || MSG_STYLES.info);
    el.innerText = text;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add("hidden"); }, 6000);
  }

  // نداء POST موحّد — يضبط Content-Type: application/json دائماً (بوابة CSRF
  // بـfunctions/ ترفض أي طلب حالة-متغيّرة بلا هذا الترويسة)، ويحوّل ردوداً
  // غير JSON (صفحة تسجيل دخول، 404، عطل شبكة) لرسالة عربية مفهومة بدل خطأ
  // متصفح خام.
  function apiPost(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.text().then(function (raw) {
        let d;
        try {
          d = raw ? JSON.parse(raw) : {};
        } catch (e) {
          if (r.status === 401 || r.status === 403) {
            throw new Error("جلستك انتهت — سجّل دخولك مرة ثانية.");
          }
          throw new Error("تعذّر الاتصال بالخادم الآن. حاول بعد شوي.");
        }
        if (!r.ok || d.ok === false) throw new Error(d.error || "تعذّر تنفيذ الطلب.");
        return d;
      });
    });
  }

  // نداء موحّد لـ/api/auth/me — يرجّع بيانات الجلسة أو null بدون رمي خطأ (يُعامل
  // "غير مسجّل دخول" كحالة طبيعية، لا عطلاً).
  function checkSession() {
    return fetch("/api/auth/me", { method: "POST", headers: { "Content-Type": "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  global.escHtml = escHtml;
  global.showMsg = showMsg;
  global.showToast = showToast;
  global.apiPost = apiPost;
  global.checkSession = checkSession;
})(window);
