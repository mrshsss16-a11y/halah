// public/js/admin/api.js — نداءات لوحة الإشراف. نفس مبدأ لوحة التاجر: شكل
// الرد الخام محفوظ كما كان بموضع النداء الأصلي (المرحلة ٥ تقسيم بلا تغيير
// سلوكي)، فلا نمرّ بـapiPost الذي يرمي برسالة موحّدة.
const JSON_HEADERS = { "Content-Type": "application/json" };

function adminPostRaw(path, body) {
  const init = { method: "POST" };
  if (body !== undefined) { init.headers = JSON_HEADERS; init.body = JSON.stringify(body); }
  return fetch(path, init);
}

async function postJson(path, body) {
  const res = await adminPostRaw(path, body);
  return res.json();
}

/** /api/admin/aura_whatsapp يوجَّه كله بحقل action واحد. */
export function auraWa(action, extra) {
  return postJson("/api/admin/aura_whatsapp", { action, ...(extra || {}) });
}

export function adminOverview() {
  // بلا Content-Type ولا جسم — كما كان حرفياً.
  return postJson("/api/admin/overview");
}

export function adminLaunch() {
  return postJson("/api/admin/launch", {});
}

export function adminAccounts(payload) {
  return postJson("/api/admin/accounts", payload);
}

export function adminBookings(payload) {
  return postJson("/api/admin/bookings", payload);
}

export function generateImage(payload) {
  return postJson("/api/image", payload);
}

export async function authMe() {
  const res = await fetch("/api/auth/me", { method: "POST" });
  return res.json();
}

export function logout() {
  return fetch("/api/auth/logout", { method: "POST" });
}
