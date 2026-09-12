// متطلبات PDPL الموثّقة (2026-09-13): سجل أنشطة المعالجة، تقييم مخاطر النقل، إجراء التسرب، بنود الصفحات.
import { readFileSync, existsSync } from "node:fs";
import { createRunner } from "../_helpers.mjs";

const { assert, done } = createRunner("pdpl-docs");
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const visible = (html) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

async function main() {
  const ropa = read("../../docs/PDPL/ROPA.md");
  const transfer = read("../../docs/PDPL/TRANSFER_RISK_ASSESSMENT.md");
  const breach = read("../../docs/PDPL/BREACH_RESPONSE.md");
  assert(/جهة التحكم/.test(ropa) && /مدة الاحتفاظ/.test(ropa) && /يُفصح لـ/.test(ropa) && /فئات البيانات الشخصية/.test(ropa), "PDPL-1: سجل أنشطة المعالجة بعناصره (الجهة، الأغراض، الفئات، الاحتفاظ، الإفصاح)");
  for (const table of ["accounts", "store_products", "vision_facts", "error_log", "consultation_bookings", "whatsapp_messages"]) {
    assert(ropa.includes(`\`${table}\``), `PDPL-2: السجل يغطي جدول ${table}`);
  }
  const privacy = read("../../privacy.html");
  for (const provider of ["Cloudflare", "Groq", "Gemini", "OpenRouter", "Resend"]) {
    assert(privacy.includes(provider) && transfer.includes(provider), `PDPL-3: ${provider} مسمّى بالخصوصية ومقيَّم بتقييم مخاطر النقل`);
  }
  assert(/٧٢ ساعة/.test(breach) && /منصة حوكمة البيانات الوطنية/.test(breach) && /سجل الحوادث/.test(breach), "PDPL-4: إجراء التسرب بمهلة ٧٢ ساعة وقناة الإشعار وسجل الحوادث");

  const pv = visible(privacy);
  assert(/حوادث تسرّب البيانات/.test(pv) && /٧٢ ساعة/.test(pv) && /منصة حوكمة البيانات الوطنية/.test(pv), "PDPL-5: الخصوصية تلتزم بإشعار الجهة المختصة خلال ٧٢ ساعة وإشعار التاجر");
  const tv = visible(read("../../terms.html"));
  assert(/معالجة بيانات متجرك نيابةً عنك/.test(tv) && /لغرض واحد/.test(tv), "PDPL-6: الشروط تحدد المعالجة نيابةً عن التاجر وغرضها");
  assert(/حد يومي من الأوصاف/.test(tv) && !/أول كل شهر|بداية الشهر التالي/.test(tv), "PDPL-7: بند الحصة بالشروط يطابق الحد اليومي الحقيقي");

  const audit = read("../../functions/api/security/pdpl_audit.js");
  assert(!/"Enforced"/.test(audit.replace(/^\s*\/\/.*$/gm, "")), "PDPL-8: لا ادعاء «Enforced» ثابت بلا فحص");
  assert(existsSync(new URL("../../docs/PDPL/ROPA.md", import.meta.url)), "PDPL-9: الوثائق داخل docs/PDPL");
}

main().then(done);
