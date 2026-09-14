// انتهاء تجربة/اشتراك سلة = إيقاف لا فك ربط، والتجديد يعيد الوصول بلا إعادة تثبيت (2026-09-15).
import { readFileSync } from "node:fs";
import { createRunner, fakeKv } from "../_helpers.mjs";
import { markAccessExpired, clearAccessExpired, isAccessExpired } from "../../functions/_lib/core/accessState.js";

const { assert, done } = createRunner("access-expired");
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

async function main() {
  {
    const env = { HALA_CACHE: fakeKv() };
    assert(!(await isAccessExpired(env, "m_1")), "AE-1: متجر جديد غير موقوف");
    await markAccessExpired(env, "m_1", "app.trial.expired");
    assert((await isAccessExpired(env, "m_1")) && !(await isAccessExpired(env, "m_2")), "AE-2: الإيقاف لمتجره فقط");
    await clearAccessExpired(env, "m_1");
    assert(!(await isAccessExpired(env, "m_1")), "AE-3: التجديد يرفع الإيقاف");
    assert(!(await isAccessExpired({}, "m_1")), "AE-4: بلا KV لا يُحجب أحد بالخطأ");
  }
  {
    const salla = read("../../functions/_lib/domain/salla.js");
    const block = salla.slice(salla.indexOf('case "app.subscription.expired"'), salla.indexOf('case "product.created"'));
    assert(!/revokeSallaConnection/.test(block) && /markAccessExpired\(env, known\.id, event\)/.test(block) && /clearAccessExpired\(env, known\.id\)/.test(block), "AE-5: الانتهاء يوقف ولا يحذف التوكنات، والبدء/التجديد يرفع الإيقاف");
    assert(/case "app\.subscription\.renewed"/.test(block) && /case "app\.subscription\.started"/.test(block) && /case "app\.trial\.started"/.test(block), "AE-6: أحداث البدء والتجديد معالَجة");
    assert(/UPDATE bulk_jobs SET status = 'cancelled'[^"]*WHERE merchant_id = \?/.test(block), "AE-7: مهام الجملة الجارية تُلغى عند الانتهاء");
    const auth = salla.slice(salla.indexOf('case "app.store.authorize"'), salla.indexOf('case "app.installed"'));
    assert(/await clearAccessExpired\(env, merchantId\)/.test(auth), "AE-8: إعادة التثبيت ترفع الإيقاف");
    const uninstall = salla.slice(salla.indexOf('case "app.uninstalled"'), salla.indexOf('case "app.subscription.expired"'));
    assert(/revokeSallaConnection/.test(uninstall) && /purgeMerchantData/.test(uninstall), "AE-9: إزالة التطبيق وحدها تحذف التوكنات والبيانات");
  }
  {
    const session = read("../../functions/_lib/core/session.js");
    const gate = session.slice(session.indexOf("export async function requireCompletedAccount"), session.indexOf("export async function requireAdmin"));
    assert(/if \(await isAccessExpired\(env, merchantId\)\)/.test(gate) && /"SUBSCRIPTION_EXPIRED"/.test(gate) && /تطبيقاتي/.test(gate), "AE-10: كل ميزة تتطلب حساباً مكتملاً تُحجب برسالة تجديد واضحة");
    assert(/peek\.code === "SUBSCRIPTION_EXPIRED"/.test(read("../../public/js/dashboard/account.js")), "AE-11: الواجهة تعرض رسالة انتهاء الاشتراك");
  }
}

main().then(done);
