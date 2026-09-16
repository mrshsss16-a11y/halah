// معيار COPY_STANDARD §5.2/§6.6/§7.4/§7.5 — ثلاث قواعد إضافية (2026-09-16):
// كشف الآلية الموسّع («الظاهر»، «يبدو»، «الإضاءة»/«الخلفية» بسياق الصورة)، سقف تكرار
// الكلمة المفتاحية (٣ ورودات كحدّ أقصى بالمنشور)، وازدواج افتتاحية النبذة مع الوصف.
import { createRunner } from "../_helpers.mjs";
import { dropMechanismClauses } from "../../functions/_lib/domain/copyLeaks.js";
import { polishPage } from "../../functions/_lib/domain/copyPage.js";

const { assert, done } = createRunner("copy-standard-rest");

// ── القاعدة ١: معجم كشف الآلية الموسّع (٧.٥) ───────────────────────────────────
{
  // عيب حقيقي: جواب سؤال شائع قال حقيقة توفّر ثم وصف الصورة بجملة ثانية.
  const faq = "تتوفر التنورة باللونين الرمادي والبنفسجي. اللون الظاهر في الصورة هو الرمادي.";
  const got = dropMechanismClauses(faq);
  assert(got === "تتوفر التنورة باللونين الرمادي والبنفسجي.", `R1-1: «اللون الظاهر في …» تُحذف كاملة وتبقى حقيقة التوفّر («${got}»)`);
}
{
  // حالة سلبية: ملاحظة تاجر حقيقية عن تفصيل مادي بالقطعة نفسها («ظاهرة» نكرة بلا أل) — لا تُحذف.
  const note = "التنورة بها تفصيل خياطة ظاهرة من الخارج عند الحاشية.";
  const got = dropMechanismClauses(note);
  assert(got === note, `R1-2 (سلبي): «خياطة ظاهرة» وصف مادي حقيقي لا يُمس («${got}»)`);
}
{
  const got = dropMechanismClauses("كما يظهر بالصورة، القماش لامع قليلاً.");
  assert(!/كما[ \t]+يظهر/u.test(got), `R1-3: «كما يظهر» بمقطع الصورة يُحذف («${got}»)`);
}
{
  const got = dropMechanismClauses("الإضاءة في الصورة تُبرز اللون بدرجة أفتح من الحقيقي.");
  assert(!/الإضاءة/u.test(got), `R1-4: «الإضاءة في الصورة» تُحذف («${got}»)`);
}
{
  // حالة سلبية: «الإضاءة» بلا سياق صورة (لو ورد كإكسسوار مثلاً) لا يجب أن يُحذف السطر كله بلا داعٍ.
  const got = dropMechanismClauses("تصميم الغرفة يعتمد على إضاءة دافئة وستائر قطنية.");
  assert(got === "تصميم الغرفة يعتمد على إضاءة دافئة وستائر قطنية.", `R1-5 (سلبي): «إضاءة» نكرة بلا سياق صورة لا تُمس («${got}»)`);
}

// ── القاعدة ٢: سقف تكرار الكلمة المفتاحية (٥.٢/٧.٤ C10(ب)) ─────────────────────
{
  const src = "فستان ميدي أحمر بقصّة واسعة، بأزرار أمامية وجيوب جانبية، مصنوع من قماش قطن.";
  const p = {
    copywriting: {
      description: "فستان ميدي أحمر بقصّة واسعة.\n\nفستان ميدي مصنوع من قماش قطن مريح للاستخدام اليومي.",
      excerpt: "", whatsapp: "",
      highlights: ["فستان ميدي بأزرار أمامية أنيقة", "فستان ميدي بجيوب جانبية عملية"]
    },
    seo: { title: "فستان ميدي أحمر" },
    faqs: [{ q: "هل يتوفر فستان ميدي بمقاس XL؟", a: "نعم فستان ميدي متوفر بمقاس XL أيضاً." }],
    specsTable: [], tags: []
  };
  const out = polishPage(JSON.parse(JSON.stringify(p)), { name: "فستان ميدي أحمر", sourceText: src, category: "فساتين" });
  const full = [out.copywriting.description, ...out.copywriting.highlights, ...out.faqs.flatMap((f) => [f.q, f.a])].join(" ");
  const count = (full.match(/فستان[ \t]+ميدي/gu) || []).length;
  assert(count <= 3, `R2-1: ستة ورودات لـ«فستان ميدي» ⇒ ٣ فأقل بعد المعالجة (عدد: ${count})`);
  assert(out.copywriting.description.startsWith("فستان ميدي أحمر بقصّة واسعة."), `R2-2: الجملة الأولى من الوصف لم تُمس («${out.copywriting.description}»)`);
  assert(out.seo.title === "فستان ميدي أحمر", `R2-3: seo.title لم يُمس («${out.seo.title}»)`);
}
{
  // حالة سلبية: كلمة مفتاحية بمرّتين فقط ⇒ لا تعديل إطلاقاً (نص مطابق حرفياً بعد المعالجة).
  const src = "فستان ميدي أزرق بقصّة مستقيمة وخصر مطاطي.";
  const p = {
    copywriting: { description: "فستان ميدي أزرق بقصّة مستقيمة.\n\nمصنوع من قماش قطن ناعم الملمس.", excerpt: "", whatsapp: "", highlights: ["خصر مطاطي مريح للجلوس"] },
    seo: { title: "فستان ميدي أزرق" },
    faqs: [{ q: "ما الخامة؟", a: "قطن مخلوط ناعم الملمس ومريح." }],
    specsTable: [], tags: []
  };
  const out = polishPage(JSON.parse(JSON.stringify(p)), { name: "فستان ميدي أزرق", sourceText: src, category: "فساتين" });
  assert(out.copywriting.description === "فستان ميدي أزرق بقصّة مستقيمة.\n\nمصنوع من قماش قطن ناعم الملمس.", `R2-4 (سلبي): مرّتان فقط ⇒ الوصف بلا أي تغيير («${out.copywriting.description}»)`);
}

// ── القاعدة ٣: ازدواج النبذة مع افتتاحية الوصف (٧.٤ C8) ────────────────────────
{
  const opening = "فستان ميدي بيج بقصّة واسعة وياقة دائرية وأكمام واسعة، بطيّات بليسيه ودانتيل وقماش مطفي.";
  const oldExcerpt = "فستان ميدي بقصّة واسعة ولون بيج، مع ياقة دائرية وأكمام واسعة وتفاصيل بليسيه ودانتيل. متوفر بالزيتي والبيج.";
  const p = { copywriting: { description: opening, excerpt: oldExcerpt, whatsapp: "", highlights: [] }, seo: { title: "فستان ميدي" }, faqs: [], specsTable: [], tags: [] };
  const out = polishPage(p, { name: "فستان ميدي بيج", sourceText: opening, category: "فساتين" });
  assert(!/بليسيه|دانتيل|ياقة/u.test(out.copywriting.excerpt.split(/[.!؟]/u)[0]), `R3-1: افتتاحية النبذة بعد المعالجة لا تكرر تفاصيل الياقة/البليسيه/الدانتيل («${out.copywriting.excerpt}»)`);
  assert(/الزيتي|بيج/u.test(out.copywriting.excerpt), `R3-2: النبذة تبقي معلومة الألوان الجديدة («${out.copywriting.excerpt}»)`);
}
{
  // حالة سلبية: نبذة مميزة أصلاً (لا تشابه ٧٠٪+ مع الافتتاحية) لا تُمس.
  const opening = "فستان ميدي بيج بقصّة واسعة وياقة دائرية وأكمام واسعة.";
  const distinctExcerpt = "يتوفر بمقاسات S وM وL، ويُنظَّف جافاً فقط.";
  const p = { copywriting: { description: opening, excerpt: distinctExcerpt, whatsapp: "", highlights: [] }, seo: { title: "فستان ميدي" }, faqs: [], specsTable: [], tags: [] };
  const out = polishPage(p, { name: "فستان ميدي بيج", sourceText: `${opening} ${distinctExcerpt}`, category: "فساتين" });
  assert(out.copywriting.excerpt === distinctExcerpt, `R3-3 (سلبي): نبذة مميزة أصلاً تبقى بلا تعديل («${out.copywriting.excerpt}»)`);
}

done();
