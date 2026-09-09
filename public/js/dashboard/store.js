// public/js/dashboard/store.js — تبويب «متجري» (حالة الربط، المنتجات، الطلبات)
// وعدّادات الحصة الشهرية بالشريط العلوي، والخروج.
import { S } from "./state.js";
import { postStoreOverview, postUsage, postLogout } from "./api.js";
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
  const msgEl = document.getElementById("kpiUsageMsg");
  try {
    const { data } = await postUsage();
    descEl.innerText = data?.description ? `${data.description.remaining}/${data.description.limit}` : "—";
    msgEl.innerText = data?.message ? `${data.message.remaining}/${data.message.limit}` : "—";
  } catch (e) {
    // فشل صامت غير مقبول (M5) — تعذر الجلب يظهر كخط، لا يبقى الهيكل يدور للأبد.
    descEl.innerText = "—";
    msgEl.innerText = "—";
  } finally {
    descEl.classList.remove("skel");
    msgEl.classList.remove("skel");
  }
}

export async function handleMerchantLogout() {
  try { await postLogout(); } catch (e) {}
  window.location.href = "/login";
}
