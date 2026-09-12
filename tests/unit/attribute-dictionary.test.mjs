// قاموس المواصفات الاحترافي — فريق وكلاء بحث من متاجر رائدة (2026-09-12).
import { readFileSync } from "node:fs";
import { createRunner } from "../_helpers.mjs";
import { attributeBlockForProduct } from "../../functions/_lib/ai/attributeDictionary.js";
import { generateProductCopy } from "../../functions/_lib/domain/copy.js";

const { assert, done } = createRunner("attribute-dictionary");
const head = (b) => String(b || "").split("\n")[0];

async function main() {
  {
    const cases = [
      [{ name: "ساعة رجالية بوس كلوب ستانلس ستيل" }, /الساعات/],
      [{ name: "عطر مونتال بخور 100 مل" }, /عطور/],
      [{ name: "معمول عروق العود 100 جرام" }, /عطور/],
      [{ name: "عباية بشت كوري مطرزة بالخرز" }, /عبايات/],
      [{ name: "ثوب مغربي رجالي رصاصي" }, /رجالية/],
      [{ name: "خاتم ذهب وردة عيار 21" }, /مجوهرات/],
      [{ name: "عقد فضة زهرة خريف" }, /مجوهرات/],
      [{ name: "جزمة رجالي هندي رسمي" }, /أحذية/],
      [{ name: "حقيبة لايرين كروس ميني" }, /حقائب/],
      [{ name: "فستان شادن كحلي طويل" }, /ملابس نسائية/],
      [{ name: "منتج جديد", category: "ساعات" }, /الساعات/]
    ];
    const misses = cases.filter(([input, re]) => !re.test(head(attributeBlockForProduct(input)))).map(([input]) => input.name);
    assert(misses.length === 0, `AD-1: كل منتج يُطابق قاموس فئته — الكلمة الأولى ثم الاسم ثم الفئة (${misses.join("، ")})`);
    assert(attributeBlockForProduct({ name: "معطر سيارة", category: "سيارات" }) === "" && attributeBlockForProduct() === "", "AD-2: منتج خارج الفئات بلا قاموس");
  }
  {
    const blocks = ["ساعة", "عطر", "عباية", "ثوب", "خاتم", "حذاء", "حقيبة", "فستان"].map((n) => attributeBlockForProduct({ name: n }));
    const MATERIAL = /(?<!\p{L})(?:جلد|جلدي|حرير|ساتان|قطن|كتان|مخمل|شيفون|كريب|ذهب(?!ي)|فضة|ألماس|ستانلس|فولاذ|تيتانيوم|سيراميك)(?!\p{L})/u;
    const valueLines = blocks.flatMap((b) => b.split("\n").slice(1).filter((l) => l.startsWith("- ") && !/≠/.test(l)));
    assert(blocks.every((b) => b.length > 500 && b.length < 2800), `AD-3: كل كتلة قاموس بين 500 و2800 حرف (${blocks.map((b) => b.length).join(",")})`);
    assert(blocks.every((b) => (b.match(/\(/g) || []).length === (b.match(/\)/g) || []).length), "AD-4: لا أقواس معلّقة من قص وسط الكلمة");
    assert(!valueLines.some((l) => MATERIAL.test(l)), `AD-5: لا قيمة تسمّي مادة بقوائم ما يُرى (${valueLines.find((l) => MATERIAL.test(l)) || ""})`);
    assert(/أكمام|الأكمام/.test(blocks[7]) && /المينا/.test(blocks[0]) && /≠/.test(blocks[0]), "AD-6: قاموس الفستان يسمّي الأكمام، والساعة المينا، مع التباسات");
    assert(/بليسيه ≠ كسرات عريضة/.test(blocks[7]) && /سطح القماش: لامع/.test(blocks[7]) && !/بطيّات \(بليسيه\)/.test(blocks[7]), "AD-6b: البليسيه يُميَّز عن الكسرات العريضة، ولمعان القماش صفة مرئية (تنورة حقيقية 2026-09-12)");
    const full = JSON.parse(readFileSync(new URL("../../docs/sources/attribute_dictionary_ksa.json", import.meta.url), "utf8"));
    assert(Array.isArray(full) && full.length === 8 && full.every((c) => c.verified && c.dictionary?.attributes?.length >= 8), "AD-7: القاموس الكامل بمصادره محفوظ بالوثائق (8 فئات متحقق منها)");
  }
  {
    let visionInput = "";
    const systems = [];
    const AI = { run: async (_m, input) => {
      const c = input?.messages?.[0]?.content;
      if (Array.isArray(c)) { visionInput = JSON.stringify(input); return { response: "اللون: فضي. التفاصيل: مينا فيروزية بعقارب عصوية." }; }
      systems.push(c || "");
      return { response: JSON.stringify({ seo: { title: "ساعة رجالية", seoTitle: "ساعة رجالية بمينا فيروزية", metaDescription: "ساعة رجالية بمينا فيروزية وعقارب عصوية وسوار معدني بثلاث وصلات، قطر 40 ملم وحركة كوارتز بحسب بيانات المتجر." }, copywriting: { description: "ساعة رجالية بمينا فيروزية وعقارب عصوية.", excerpt: "ساعة رجالية بمينا فيروزية.", whatsapp: "ساعة رجالية.", highlights: [] }, specsTable: [], faqs: [], tags: [] }) };
    } };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(new Uint8Array([255, 216, 255, 224]), { status: 200, headers: { "content-type": "image/jpeg" } });
    try {
      await generateProductCopy({ env: { AI }, merchantId: "m_1", name: "ساعة رجالية بوس كلوب", price: "", tone: "white", category: "", features: "قطر 40 ملم؛ حركة كوارتز", existingDescription: "", imageUrl: "https://cdn.example.com/watch.jpg", keywordsExtra: [] });
    } finally { globalThis.fetch = realFetch; }
    assert(/قاموس مواصفات الساعات/.test(visionInput), "AD-8: قاموس الساعات يصل توجيه قارئ الصورة");
    assert(/التزمي بنفس مصطلحات ملاحظات الصورة حرفياً/.test(systems[0] || ""), "AD-9: الكاتب ملزم بمصطلحات ملاحظات الصورة حرفياً (التي سمّاها القاموس)");
  }
}

main().then(done);
