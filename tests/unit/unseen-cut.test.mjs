// تنورة حقيقية 2026-09-12 18:29: تنقية الملاحظات حذفت سطر الكسرات والطول لذكرهما البلوزة والحذاء،
// فاخترع الكاتب «بخصر مرتفع، تتميز بقصّتها المستقيمة» لتنورة واسعة.
import { createRunner } from "../_helpers.mjs";
import { productOnlyNotes } from "../../functions/_lib/domain/copyNotes.js";
import { dropUnseenCut, unseenCutPhrases, stripJudgments } from "../../functions/_lib/domain/copyPhrases.js";
import { polishPage } from "../../functions/_lib/domain/copyPage.js";
import { detectLessons } from "../../functions/_lib/domain/copyLessons.js";

const { assert, done } = createRunner("unseen-cut");

async function main() {
  {
    const real = productOnlyNotes("اللون: أسود. التفاصيل: تنورة بكسرات عريضة تحت بلوزة شفافة. الطول والقصّة: ميدي تصل فوق الكاحل مع حذاء بكعب. الطابع العام: إضاءة نهارية، طابع رسمي.", "تنورة");
    assert(/بكسرات عريضة/.test(real) && /ميدي تصل فوق الكاحل/.test(real) && !/بلوزة|حذاء|تحت\.|مع\./.test(real), `UC-1: سطر فيه قطعة أخرى يُقص عندها ولا يُحذف كله («${real}»)`);
    const model = productOnlyNotes("الطول والقصّة: ميدي تصل إلى منتصف ساق العارضة. التفاصيل: كسرات عريضة، والعارضة تقف أمام خلفية بيضاء.", "تنورة");
    assert(/منتصف الساق/.test(model) && /كسرات عريضة/.test(model) && !/العارضة|تقف|خلفية/.test(model), `UC-2: ذكر العارضة يُقص لا يحذف السطر («${model}»)`);
    const blouse = productOnlyNotes("اللون: أبيض. التفاصيل: أكمام دانتيل، ومرفق به تنورة بقصّة A. التنورة: بقصّة A.", "بلوزة");
    assert(/أكمام دانتيل/.test(blouse) && !/تنورة|مرفق/.test(blouse), `UC-3: «ومرفق به تنورة» وسطر القطعة الأخرى ما زالا يُحذفان («${blouse}»)`);
  }
  {
    const thin = "اللون: أسود. الطابع العام: إضاءة نهارية، طابع رسمي.";
    const published = "تنورة سوداء ميدي بخصر مرتفع، تتميز بقصّتها المستقيمة اللي تعطي إطلالة مرتبة. لونها الأسود يخليها قطعة أساسية.\n\nتصميمها الرسمي يناسب الدوام.";
    const fixed = dropUnseenCut(published, { notes: thin, name: "تنورة" });
    assert(fixed.startsWith("تنورة سوداء ميدي. لونها الأسود") && !/مستقيم|خصر/.test(fixed) && /\n\nتصميمها الرسمي/.test(fixed), `UC-4: الوصف المنشور فعلاً يفقد القصّة والخصر المخترعين ويبقى سليماً («${fixed}»)`);
    const seen = "الطول والقصّة: ميدي، بقصّة واسعة. التفاصيل: كسرات عريضة، خصر مرتفع.";
    assert(dropUnseenCut("تنورة بخصر مرتفع وكسرات عريضة، بقصّتها الفضفاضة.", { notes: seen, name: "تنورة" }) === "تنورة بخصر مرتفع وكسرات عريضة، بقصّتها الفضفاضة.", "UC-5: ما ذكرته الصورة يبقى (فضفاضة من عائلة واسعة)");
    assert(unseenCutPhrases("تنورة بقصّة مستقيمة", "") .length === 0 && unseenCutPhrases("تنورة بقصّة مستقيمة", thin, "تنورة قصة مستقيمة").length === 0, "UC-6: بلا صورة لا حكم، وبيانات التاجر تسند الصفة");
  }
  {
    const page = {
      copywriting: { description: "تنورة سوداء بخصر مرتفع، تتميز بقصّتها المستقيمة. تُلبس للدوام.", excerpt: "تنورة سوداء بقصّة مستقيمة.", whatsapp: "", highlights: ["بقصّة مستقيمة تعطي مظهراً مرتباً", "لون أسود يسهل تنسيقه مع البلوزات"] },
      seo: { title: "تنورة سوداء بخصر مرتفع", seoTitle: "تنورة سوداء بخصر مرتفع", metaDescription: "تنورة سوداء بخصر مرتفع. تُلبس للدوام." },
      faqs: [{ q: "هل قصتها مستقيمة؟", a: "نعم قصتها مستقيمة." }, { q: "ما لونها؟", a: "أسود." }],
      specsTable: [{ key: "القصة", value: "قصة مستقيمة" }, { key: "اللون", value: "أسود" }],
      imageAlt: "تنورة سوداء بخصر مرتفع", tags: []
    };
    polishPage(page, { name: "تنورة", notes: "اللون: أسود. الطابع العام: رسمي.", sourceText: "تنورة" });
    const all = JSON.stringify(page);
    assert(!/مستقيم|خصر/.test(all) && page.seo.title === "تنورة سوداء" && page.faqs.length === 1 && page.specsTable.length === 1 && page.copywriting.highlights.length === 1, `UC-7: كل حقول الصفحة تفقد القصّة والخصر المخترعين (${all.slice(0, 200)})`);
  }
  {
    const lessons = detectLessons({ draft: "تنورة بخصر مرتفع وقصّة مستقيمة.", notes: "اللون: أسود.", sourceText: "تنورة" });
    assert(lessons.some((l) => l.code === "UNSEEN_CUT" && l.target === "writer"), "UC-8: القصّة المخترعة تصير درساً للكاتب");
    const dangling = stripJudgments("تنورة ميدي سوداء بقصّة واسعة وتصميم أنيق، تتميز بكسرات عريضة.");
    assert(dangling === "تنورة ميدي سوداء بقصّة واسعة، تتميز بكسرات عريضة.", `UC-9: «وتصميم أنيق» تُحذف كاملة لا صفتها وحدها («${dangling}»)`);
  }
}

main().then(done);
