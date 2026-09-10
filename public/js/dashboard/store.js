// public/js/dashboard/store.js — تبويب «متجري» (حالة الربط، المنتجات، الطلبات)
// وعدّادات الحصة الشهرية بالشريط العلوي، والخروج.
import { S } from "./state.js";
import { postStoreOverview, postUsage, postLogout, postStoreDelete } from "./api.js";
import { setPublishTarget, onPublishProductChange } from "./studio.js";

const escHtml = window.escHtml;

export async function loadStore() {
  try {
    const { res, data } = await postStoreOverview();
    // خطأ خادم (401/500) كان يُعرض "متجرك غير مرتبط" + زر ربط — تفسير خاطئ لعطل مؤقت.
    if (!res.ok) {
      document.getElementById("storeLinkState").innerText = "تعذّر جلب حالة متجرك الآن — هذا لا يعني أن الربط انقطع، حدّث الصفحة بعد قليل.";
      return;
    }

    const linked = data?.linked && data?.platforms?.salla;
    document.getElementById("storeConnected").classList.toggle("hidden", !linked);
    document.getElementById("storeDisconnected").classList.toggle("hidden", !!linked);
    document.getElementById("storeLinkState").innerText = linked ? "مرتبط ✅" : "غير مرتبط";

    if (linked) {
      document.getElementById("connectedStoreName").innerText = data.storeName || "—";
      const list = document.getElementById("productList");
      const sel = document.getElementById("publishProduct");
      list.innerHTML = "";
      sel.innerHTML = "";
      (data.products || []).forEach((p) => {
        const row = document.createElement("div");
        row.className = "p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-black";
        row.innerText = p.name;
        list.appendChild(row);

        const opt = document.createElement("option");
        opt.value = p.id;
        opt.innerText = p.name;
        sel.appendChild(opt);
      });
      // إعادة بناء القائمة تمسح الخيار المُضاف من "منتجاتي" — نُعيد ضبطه.
      const keep = S.selectedCatalogProduct;
      document.getElementById("publishBox").classList.toggle("hidden", !(data.products || []).length);
      if (keep && keep.productId) setPublishTarget(keep.productId, keep.name);
      else onPublishProductChange();

      const orderList = document.getElementById("orderList");
      orderList.innerHTML = "";
      const orders = data.orders || [];
      if (!orders.length) {
        const empty = document.createElement("div");
        empty.className = "p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500";
        empty.innerText = "لا توجد طلبات بعد";
        orderList.appendChild(empty);
      } else {
        orders.forEach((o) => {
          const row = document.createElement("div");
          row.className = "p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-black flex justify-between gap-2";
          // reference/status come straight from the Salla Orders API.
          row.innerHTML = `<span>${escHtml(o.reference || o.id)}</span><span class="text-slate-500">${escHtml(o.status || "")}</span>`;
          orderList.appendChild(row);
        });
      }
    }

    const errBox = document.getElementById("storeErrors");
    const errKeys = Object.keys(data.errors || {});
    if (linked && errKeys.length) {
      const labels = { sallaProducts: "المنتجات", sallaOrders: "الطلبات", trendyol: "ترندايول", carts: "السلات المتروكة" };
      errBox.innerText = "تعذر تحديث: " + errKeys.map((k) => labels[k] || k).join("، ") + " — سنعيد المحاولة تلقائياً.";
      errBox.classList.remove("hidden");
    } else {
      errBox.classList.add("hidden");
    }
  } catch (e) {
    document.getElementById("storeLinkState").innerText = "تعذر الاتصال بالمتجر — تحقق من اتصالك وحاول مرة أخرى.";
  } finally {
    document.getElementById("storeLinkState").classList.remove("skel");
  }
}

export async function loadUsage() {
  const descEl = document.getElementById("kpiUsageDesc");
  try {
    const { data } = await postUsage();
    descEl.innerText = data?.description ? `${data.description.remaining}/${data.description.limit}` : "—";
  } catch (e) {
    // فشل صامت غير مقبول (M5) — تعذر الجلب يظهر كخط، لا يبقى الهيكل يدور للأبد.
    descEl.innerText = "—";
  } finally {
    descEl.classList.remove("skel");
  }
}

export async function handleMerchantLogout() {
  try { await postLogout(); } catch (e) {}
  window.location.href = "/login";
}

// ── الحذف الذاتي ────────────────────────────────────────────────────
//
// الزرّان معطّلان حتى تُكتب العبارة حرفياً. البوابة الحقيقية بالخادم — هذي
// تمنع الضغطة العابرة لا الخصم.
const DELETE_CONFIRM_PHRASE = "احذف بياناتي";

const deleteButtons = () => [
  document.getElementById("deleteSallaBtn"),
  document.getElementById("deleteAccountBtn")
];

export function onDeleteConfirmInput() {
  const typed = (document.getElementById("deleteConfirmInput").value || "").trim();
  const ok = typed === DELETE_CONFIRM_PHRASE;
  deleteButtons().forEach((b) => { if (b) b.disabled = !ok; });
}

export async function requestDeletion(mode) {
  const confirm = (document.getElementById("deleteConfirmInput").value || "").trim();
  const warn = mode === "account"
    ? "سيُحذف حسابك وكل بياناتك نهائياً. لا يمكن التراجع. متأكد؟"
    : "سيُفكّ ربط سلة وتُحذف بيانات متجرك نهائياً. لا يمكن التراجع. متأكد؟";
  if (!window.confirm(warn)) return;

  deleteButtons().forEach((b) => { if (b) b.disabled = true; });
  try {
    const { res, data } = await postStoreDelete(mode, confirm);
    // خطأ خادم بلا حقل error كان يُعرض كنجاح بأماكن أخرى — لا يتكرر هنا.
    if (!res.ok || data?.error) {
      window.showMsg("deleteFeedback", data?.error || "ما قدرنا نكمل الحذف. حاول مرة ثانية.", "error");
      onDeleteConfirmInput();
      return;
    }
    // حذف جزئي يُقال كما هو: ادعاء «تم بالكامل» عن محو ناقص أسوأ من الناقص.
    const text = data.partial
      ? data.message + " (بقيت أجزاء تعذّر محوها — سجّلناها ونكملها، راسلنا لو حبيت تأكيداً.)"
      : data.message;
    window.showMsg("deleteFeedback", text, data.partial ? "error" : "success");
    setTimeout(() => { window.location.href = data.accountDeleted ? "/" : "/login"; }, 4000);
  } catch (e) {
    window.showMsg("deleteFeedback", "تعذّر الاتصال. ما انحذف شي — حاول مرة ثانية.", "error");
    onDeleteConfirmInput();
  }
}
