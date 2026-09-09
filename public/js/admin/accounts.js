// public/js/admin/accounts.js — جداول التجار وتذاكر الاستشارات وإجراءاتهما.
// esc = escHtml من /js/shared.js — كل قيمة من D1 (بريد التاجر، اسم المتجر،
// هاتف الحاجز) تمرّ به قبل innerHTML.
import { adminAccounts, adminBookings } from "./api.js";
import { loadAdminData } from "./overview.js";

const esc = (v) => window.escHtml(v);

export async function loadAccountsList() {
  const tbody = document.getElementById("accountsTableBody");
  try {
    const data = await adminAccounts({ action: "list" });
    if (data?.ok && Array.isArray(data?.rows)) {
      if (data.rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-600">لا يوجد حسابات حتى الآن.</td></tr>';
        return;
      }
      tbody.innerHTML = data.rows.map((row) => {
        const used = row?.creditsUsed ?? 0;
        const limit = row?.dailyLimit ?? 50;
        const pct = Math.min(100, Math.round((used / limit) * 100));

        return `
          <tr class="hover:bg-slate-50 transition border-b border-slate-200">
            <td class="p-3.5 font-bold text-black">${esc(row?.email ?? "بدون بريد")}</td>
            <td class="p-3.5 font-mono text-[11px] text-slate-600">${esc(row?.merchantId ?? row?.merchant_id ?? "-")}</td>
            <td class="p-3.5 font-bold text-black">${esc(row?.storeName ?? "متجر غير معنون")}</td>
            <td class="p-3.5">
              <div class="space-y-1">
                <div class="flex items-center justify-between text-[11px] font-bold font-mono">
                  <span class="text-black">${used} / ${limit} رصيد</span>
                  <span class="text-slate-500">(${pct}%)</span>
                </div>
                <div class="w-28 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                  <div class="bg-black h-1.5 rounded-full transition-all" style="width: ${pct}%"></div>
                </div>
              </div>
            </td>
            <td class="p-3.5 text-slate-600 font-mono">${esc(row?.createdAt ?? "-")}</td>
            <td class="p-3.5">
              <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${row?.disabled ? "bg-slate-200 text-slate-700 border border-slate-300" : "bg-black text-white"}">
                ${row?.disabled ? "معطّل" : "نشط"}
              </span>
            </td>
            <td class="p-3.5 text-center space-x-1 space-x-reverse">
              <button onclick="toggleAccountDisabled('${esc(row?.merchantId)}', ${!row?.disabled})" class="px-2.5 py-1 rounded-lg text-[10px] font-bold ${row?.disabled ? "bg-black text-white" : "sleek-btn-white"}">
                ${row?.disabled ? "تفعيل" : "تجميد"}
              </button>
              <button onclick="resetAccountQuota('${esc(row?.merchantId)}')" class="px-2.5 py-1 rounded-lg text-[10px] font-bold sleek-btn-white">
                تصفير الرصيد
              </button>
            </td>
          </tr>
        `;
      }).join("");
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-600 font-bold">تعذر تحميل بيانات الحسابات.</td></tr>';
  }
}

export async function resetAccountQuota(merchantId) {
  if (!confirm("هل تريد إعادة تصفير رصيد الاستهلاك اليومي لهذا المتجر؟")) return;
  try {
    const data = await adminAccounts({ action: "resetQuota", merchantId });
    if (data?.ok) {
      alert("تم إعادة تصفير رصيد استهلاك المتجر لليوم بنجاح! ✅");
      loadAccountsList();
      loadAdminData();
    }
  } catch (err) {
    alert("تعذر تصفير الرصيد.");
  }
}

export async function toggleAccountDisabled(merchantId, disabled) {
  try {
    const data = await adminAccounts({ action: "setDisabled", merchantId, disabled });
    if (data?.ok) {
      loadAccountsList();
    }
  } catch (err) {
    alert("تعذر تحديث حالة الحساب.");
  }
}

export async function loadBookingsList() {
  const tbody = document.getElementById("bookingsTableBody");
  try {
    const data = await adminBookings({ action: "list" });
    if (data?.ok && Array.isArray(data?.rows)) {
      if (data.rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-600">لا يوجد تذاكر استشارات مسجلة.</td></tr>';
        return;
      }
      tbody.innerHTML = data.rows.map((row) => `
        <tr class="hover:bg-slate-50 transition border-b border-slate-200">
          <td class="p-3.5 font-bold font-mono text-black">${esc(row?.ticket_code ?? "AURA-00000")}</td>
          <td class="p-3.5 font-bold text-black">${esc(row?.name ?? "زائر")}</td>
          <td class="p-3.5 font-mono text-slate-600">${esc(row?.phone ?? "-")}</td>
          <td class="p-3.5 text-slate-700 font-medium">${esc(row?.slot_label ?? "-")}</td>
          <td class="p-3.5">
            <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${row?.status === "confirmed" ? "bg-black text-white" : "bg-slate-100 text-black border border-slate-300"}">
              ${row?.status === "confirmed" ? "مؤكدة" : (row?.status === "cancelled" ? "ملغاة" : "قيد الانتظار")}
            </span>
          </td>
          <td class="p-3.5 text-center flex items-center justify-center gap-1.5">
            <button onclick="updateBookingStatus('${esc(row?.id)}', 'confirmed')" class="bg-black text-white hover:bg-slate-800 px-2.5 py-1 rounded-lg text-[10px] font-bold">تأكيد</button>
            <button onclick="updateBookingStatus('${esc(row?.id)}', 'cancelled')" class="sleek-btn-white px-2.5 py-1 rounded-lg text-[10px] font-bold">إلغاء</button>
          </td>
        </tr>
      `).join("");
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-600 font-bold">تعذر تحميل قائمة التذاكر.</td></tr>';
  }
}

export async function updateBookingStatus(id, status) {
  try {
    const data = await adminBookings({ action: "setStatus", id, status });
    if (data?.ok) {
      loadBookingsList();
    }
  } catch (err) {
    alert("تعذر تحديث حالة التذكرة.");
  }
}
