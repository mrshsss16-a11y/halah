#!/usr/bin/env node
/**
 * A6 — يولّد `persona/*.md` من الثوابت المصدَّرة بـ`functions/_lib/ai/persona.js`.
 *
 * لماذا: كان `persona/` نسخة **يدوية موازية** للنص التشغيلي، بتعليمة "عدّل
 * الملفين معاً". انحرفت فعلاً (تقييم 2026-09-09، A6): أحالت لمسار غير موجود
 * (`functions/_lib/persona.js` بلا `ai/`)، وأسقطت قاعدة **منع ذكر أي سعر** —
 * وهي أهم قاعدة بالشخصية — ولم يكن فيها مرجع لشخصية واتساب إطلاقاً. مرجع
 * يناقض التشغيل أسوأ من غياب المرجع.
 *
 * الآن: مصدر واحد (persona.js) ومجلد مولَّد. `tests/ai-wave.test.mjs` يعيد
 * التوليد بالذاكرة ويقارن، فيفشل `npm test` عند أي انحراف.
 *
 * التشغيل: node scripts/export-persona.mjs
 */
import { writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PERSONA_DIR = join(ROOT, "persona");

const BANNER = (constName) => `<!-- مولَّد آلياً — لا تحرّر -->

> ⚠️ **مولَّد آلياً — لا تحرّر هذا الملف.**
> المصدر الوحيد: \`functions/_lib/ai/persona.js\` ← الثابت \`${constName}\`.
> أعد التوليد بـ\`node scripts/export-persona.mjs\` بعد أي تعديل على الشخصية.
> أي تحرير يدوي هنا يُمحى، ويفشل \`npm test\` (اختبار PERSONA-GEN) حتى تعاد المزامنة.

---

`;

/** الملفات المولَّدة: اسم الملف ← اسم الثابت المصدَّر. */
export const PERSONA_EXPORTS = [
  ["hala-marketer-system-prompt.md", "PERSONA_SYSTEM_PROMPT"],
  ["hala-support-knowledge.md", "HALA_SUPPORT_PROMPT"],
  ["hala-whatsapp-support.md", "HALA_WHATSAPP_SUPPORT_PROMPT"],
  ["instagram-comment-rules.md", "INSTAGRAM_PUBLIC_COMMENT_RULES"],
  ["instagram-dm-rules.md", "INSTAGRAM_DM_RULES"],
  ["white-dialect-rules.md", "WHITE_DIALECT_RULES"],
  ["booking-instructions.md", "BOOKING_INSTRUCTIONS"],
  ["escalation-instructions.md", "ESCALATION_INSTRUCTIONS"]
];

/** يبني محتوى كل ملف من وحدة الشخصية — بلا كتابة على القرص (لأجل الاختبار). */
export async function buildPersonaFiles() {
  const persona = await import("../functions/_lib/ai/persona.js");
  const files = new Map();
  for (const [fileName, constName] of PERSONA_EXPORTS) {
    const value = persona[constName];
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`persona.js لا يصدّر نصاً باسم ${constName}`);
    }
    files.set(fileName, `${BANNER(constName)}${value.trim()}\n`);
  }
  return files;
}

async function main() {
  const files = await buildPersonaFiles();

  // حذف كل .md قديم بالمجلد قبل الكتابة — الملفات المتعارضة اليدوية يجب أن
  // تختفي، لا أن تتعايش مع المولَّد فيبقى المرجع مزدوجاً.
  for (const name of readdirSync(PERSONA_DIR)) {
    if (name.endsWith(".md") && !files.has(name)) {
      unlinkSync(join(PERSONA_DIR, name));
      console.log(`− حُذف ملف قديم متعارض: persona/${name}`);
    }
  }

  for (const [name, content] of files) {
    writeFileSync(join(PERSONA_DIR, name), content, "utf8");
    console.log(`✅ persona/${name}`);
  }
  console.log(`\nتم توليد ${files.size} ملفاً من functions/_lib/ai/persona.js`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error("❌ فشل توليد persona/:", e.message);
    process.exit(1);
  });
}
