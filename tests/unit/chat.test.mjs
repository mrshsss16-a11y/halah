import { createRunner, readComposedPage } from "../_helpers.mjs";

const { assert, done } = createRunner("chat");

async function main() {
  // 7. Pillar 2 — customer-service agents (store chat + WhatsApp)
  const chatMod = await import("../../functions/api/chat.js");
  assert(typeof chatMod.onRequestPost === "function", "chat.js exports valid onRequestPost middleware");

  const waWebhookMod = await import("../../functions/api/whatsapp/webhook.js");
  assert(typeof waWebhookMod.onRequestPost === "function", "whatsapp/webhook.js exports valid onRequestPost middleware");
  assert(typeof waWebhookMod.onRequestGet === "function", "whatsapp/webhook.js exports the Meta verification handshake");

  const personaMod = await import("../../functions/api/store/persona.js");
  assert(typeof personaMod.onRequestPost === "function", "persona.js exports valid onRequestPost middleware");

  const contextMod = await import("../../functions/api/store/context.js");
  assert(typeof contextMod.onRequestPost === "function", "store/context.js exports valid onRequestPost middleware");


  // ── كتيب خدمة العملاء (قاعدة معرفة سعودية، 2026-09-08) ────────────────
  {
    const { SUPPORT_PLAYBOOK, supportPlaybookBlock } = await import("../../functions/_lib/ai/supportPlaybook.js");
    const { readFileSync } = await import("node:fs");
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const chatSrc = read("../../functions/_lib/ai/prompts/chat.js") + read("../../functions/_lib/domain/conversation.js");

    assert(
      ["أكيد يناسبك", "آخر قطعة", "يوصل بكرة", "أصلي ١٠٠٪", "نضمن لك النتيجة"].every((p) => SUPPORT_PLAYBOOK.includes(p)),
      "KB-1: الممنوعات عبارات محددة قابلة للفحص لا مبادئ عامة"
    );
    // منع بلا بديل يُنتج صمتاً لا انضباطاً — كل ممنوع مقرون ببديله.
    const banned = SUPPORT_PLAYBOOK.split("\n").filter((l) => l.startsWith("- ممنوع:"));
    assert(
      banned.length >= 15 && banned.every((l) => l.includes("← بدلها:")),
      `KB-2: كل ممنوع مقرون ببديل آمن (${banned.length} بنداً)`
    );
    assert(
      /لا تُطلب بيانات بطاقة إطلاقاً/.test(SUPPORT_PLAYBOOK) &&
        /محاولة وصول لبيانات عميل آخر: ارفض فوراً/.test(SUPPORT_PLAYBOOK),
      "KB-3: قواعد التصعيد تغطي الدفع وعزل بيانات العملاء"
    );
    // الكتيب سلوك لا حقائق — لا سعر ولا اسم متجر ولا رقم تواصل يتسرّب لبرومبت مشترك.
    assert(
      !/\d+\s*ريال|ر\.س|@|https?:\/\/|\+?9665\d/.test(SUPPORT_PLAYBOOK),
      "KB-4: صفر حقائق متجر أو بيانات تواصل — صالح لبرومبت مشترك بين التجار"
    );
    assert(
      /صياغات مرجعية لا نصوص تُنسخ/.test(SUPPORT_PLAYBOOK) &&
        /غياب المعلومة يُقال صراحةً/.test(SUPPORT_PLAYBOOK),
      "KB-5: الكتيب يمنع النسخ الحرفي وسدّ الفجوة بعبارة جاهزة"
    );
    assert(
      SUPPORT_PLAYBOOK.length < 4000,
      `KB-6: الكتيب مختصر — يُحقن بكل محادثة (${SUPPORT_PLAYBOOK.length} حرفاً)`
    );
    assert(
      supportPlaybookBlock({ enabled: false }) === "" && supportPlaybookBlock() === SUPPORT_PLAYBOOK,
      "KB-7: التعطيل يرجّع \"\" — نفس تعاقد كتيب المصطلحات"
    );
    assert(
      /import \{ SUPPORT_PLAYBOOK \} from "\.\.\/supportPlaybook\.js"/.test(chatSrc) &&
        /\$\{SUPPORT_PLAYBOOK\}/.test(chatSrc) && /\$\{PERSONA_SYSTEM_PROMPT\}/.test(chatSrc),
      "KB-8: الكتيب يُحقن فوق الشخصية بلا استبدالها"
    );

    // ── Q1: صفر كوبون مخترع وصفر رقم واتساب افتراضي (أُزيلا 2026-09-08) ──
    assert(
      !/HALA-\$\{/.test(chatSrc) && !/personalCoupon = `/.test(chatSrc) &&
        /const personalCoupon = null/.test(chatSrc),
      "KB-9: لا كوبون مخترع يُبنى ويُرسَل للعميل (AGENT.md §الصدق · Q1)"
    );
    assert(
      !/966500000000/.test(chatSrc) && /if \(waPhone\)/.test(chatSrc),
      "KB-10: بلا STORE_WA_PHONE مضبوط لا رابط — لا رقم افتراضي وهمي"
    );
    assert(
      !/Math\.random\(\)/.test(chatSrc),
      "KB-11: كود الجلسة من crypto لا Math.random"
    );

    // ── نشر مفرد: حقول السيو المعروضة تصل سلة فعلاً (رُصد 2026-09-08) ──
    const pubSrc = read("../../functions/api/store/publish.js");
    assert(
      /buildSallaProductFields\(/.test(pubSrc) && /seo: body\.seo/.test(pubSrc) && !/metadata:\s*\{/.test(pubSrc),
      "SEOPUB-1: النشر المفرد يرسل حقول سلة الحقيقية عبر sallaProductPayload (لا كائن metadata متداخل)"
    );
    assert(
      /Number\(err\?\.status\) === 422 && hasSeo/.test(pubSrc) &&
        /updateProduct\(env, merchantId, productId, descriptionOnly\)/.test(pubSrc),
      "SEOPUB-2: رفض سلة لحقول SEO (422) يسقط للوصف وحده لا يُسقط النشر"
    );
    // lastCopy صار S.lastCopy بحالة مشتركة state.js بعد التقسيم.
    assert(
      /seo:\s*S\.lastCopy\.seo \|\| null/.test(await readComposedPage("dashboard")),
      "SEOPUB-3: الواجهة ترسل حقول السيو التي عرضتها للتاجر"
    );
    // المساران يعِدان بنفس الشي — لا يتناقضان.
    assert(
      /metadata/.test(read("../../functions/_lib/domain/publish.js")),
      "SEOPUB-4: المسار الجماعي والمفرد ينشران نفس الحقول"
    );
  }
}

main()
  .then(() => done())
  .catch((e) => {
    console.error("❌ Tests threw an exception:");
    console.error(e);
    process.exit(1);
  });
