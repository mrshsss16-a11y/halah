// مكتبة الأسلوب — زرع مكتبة الأوصاف السعودية المنقّحة (2026-09-11).
//
// ما يحرسه هذا الملف:
//  ١. إعادة الزرع بعد أي تنقيح **تستبدل** ولا تكرر: مفتاح المصدر (P001) ⇒ معرّف
//     متجه ثابت. قبلها كان كل زرع يولّد معرّفاً عشوائياً، فزرعتان = ٤٨٠ مثالاً
//     مكرراً تُسترجع ثلاثتها من نفس الوصف.
//  ٢. سقف الدفعة: كل صف = تضمين + upsert + سطر D1، و٢٤٠ صفاً بطلب واحد تتجاوز
//     حد الطلبات الفرعية للدالة.
//  ٣. المفتاح يُقبل بصيغة آمنة فقط — لا نص حر يدخل معرّف المتجه.
import { readFileSync } from "node:fs";
import { createRunner } from "../_helpers.mjs";
import { storeStyleExample } from "../../functions/_lib/ai/memory.js";

const { assert, done } = createRunner("style-library");

function fakeEnv() {
  const upserts = [];
  const refs = [];
  return {
    upserts,
    refs,
    env: {
      AI: { run: async (_m, input) => (input?.text ? { data: [[0.1, 0.2, 0.3]] } : { response: "" }) },
      VECTORIZE_INDEX: { upsert: async (items) => { upserts.push(...items); } },
      DB: {
        prepare: () => ({ bind: (...b) => ({ run: async () => { refs.push(b); return {}; } }) })
      }
    }
  };
}

async function main() {
  {
    const { env, upserts } = fakeEnv();
    const a = await storeStyleExample({ env, category: "فساتين", text: "فستان سهرة طويل بقصّة A…", refKey: "P001" });
    const b = await storeStyleExample({ env, category: "فساتين", text: "فستان سهرة طويل — نسخة منقّحة ثانية", refKey: "P001" });
    assert(a === "style_example:style_library:P001" && a === b, `SL-1: نفس مفتاح المصدر ⇒ نفس معرّف المتجه (${a})، فإعادة الزرع استبدال`);
    assert(upserts.length === 2 && upserts.every((u) => u.id === a && u.metadata.storeId === "style_library"), "SL-2: المتجه يُكتب تحت دلو style_library المعزول لا تحت متجر تاجر");
    assert(upserts[1].metadata.text === "فستان سهرة طويل — نسخة منقّحة ثانية" && upserts[0].metadata.refId === "فساتين", "SL-3: النص المستبدَل هو الأحدث، والفئة بـrefId");
  }
  {
    const { env } = fakeEnv();
    const x = await storeStyleExample({ env, category: "عطور", text: "عطر…" });
    const y = await storeStyleExample({ env, category: "عطور", text: "عطر…" });
    assert(x && y && x !== y && !x.endsWith(":عطور"), "SL-4: بلا مفتاح يبقى السلوك القديم (معرّف عشوائي) — لا كسر لنداءات سابقة");
  }
  {
    const src = readFileSync(new URL("../../functions/api/admin/style_library.js", import.meta.url), "utf8");
    assert(/const MAX_ROWS_PER_BATCH = 25;/.test(src) && /rows\.length > MAX_ROWS_PER_BATCH/.test(src) && /BATCH_TOO_LARGE/.test(src), "SL-5: سقف ٢٥ صفاً بالدفعة يُرفض ما فوقه برمز مصنَّف");
    assert(/\^\[A-Za-z0-9_-\]\{1,40\}\$/.test(src) && /storeStyleExample\(\{ env, category, text: description, note, refKey \}\)/.test(src), "SL-6: مفتاح الصف يُقبل بصيغة آمنة فقط ويُمرَّر كمعرّف ثابت");
    assert(/requireAdmin\(request, env\)/.test(src), "SL-7: الزرع للأدمن فقط — لا مسار بلا جلسة أدمن");
  }
}

main().then(done);
