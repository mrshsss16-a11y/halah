// public/js/admin/main.js — نقطة الدخول الوحيدة للوحة الإشراف: نشر معالجات
// السمات المضمّنة على window، ثم حراسة الأدمن وتحميل المؤشرات — بنفس ترتيبها.
import { authMe, logout } from "./api.js";
import { switchAdminTab } from "./tabs.js";
import { loadAdminData } from "./overview.js";
import { loadAccountsList, loadBookingsList, resetAccountQuota, toggleAccountDisabled, updateBookingStatus } from "./accounts.js";
import { handleTrainAuraAgent, handleTestAuraAgentMsg, handleSaveWaCredentials, runFeatureTest } from "./aurawa.js";
import { loadLaunch } from "./launch.js";
import { previewProductImage, generateProductImageAdmin } from "./images.js";

export async function handleLogout() {
  try {
    await logout();
    window.location.href = "/login";
  } catch (err) {
    window.location.href = "/login";
  }
}

// وحدات ES لها نطاقها الخاص، وسمات onclick/onsubmit تُقيَّم بالنطاق العام —
// فالنشر الصريح هنا هو ما يبقي المعالجات تعمل. مصدر واحد لكل اسم.
Object.assign(window, {
  switchAdminTab,
  loadAdminData,
  loadAccountsList, loadBookingsList, resetAccountQuota, toggleAccountDisabled, updateBookingStatus,
  handleTrainAuraAgent, handleTestAuraAgentMsg, handleSaveWaCredentials, runFeatureTest,
  loadLaunch,
  previewProductImage, generateProductImageAdmin,
  handleLogout
});

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const data = await authMe();
    if (data?.loggedIn) {
      const isAdmin = Boolean(data?.isAdmin);
      if (!isAdmin) {
        window.location.href = "/dashboard";
        return;
      }
      if (data?.email) {
        const el = document.getElementById("adminEmailDisplay");
        if (el) el.innerText = data.email;
      }
    }
  } catch (err) {}
  loadAdminData();
});
