// اختبار تحذير الاقتراب من سقف functions/_lib (WP-A10، 2026-09-17).
//
// audit-file-size.mjs يطبع تحذيراً (بلا فشل) لكل ملف functions/_lib يقترب من
// سقفه (≥٣٩٠ من ٤٠٠). هذا الاختبار يتحقق من أمرين: (أ) الشجرة الحقيقية اليوم
// تحوي فعلاً ملفات قريبة من السقف وتظهر بتحذير الحارس بلا إفشاله، و(ب) شجرة
// وهمية مصطنعة بملف عند ٣٩٥ سطراً تُنتج تحذيراً يذكر اسمه — فالتحذير يكتشف لا
// يطبع نصاً ثابتاً بلا معنى.

import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRunner } from "../_helpers.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const FIXTURE = ".tmp-file-size-warning-fixture";
const FIXTURE_ABS = join(ROOT, FIXTURE);

const { assert, done } = createRunner("file-size-warning");

function runGuard(env = {}) {
  const res = spawnSync(process.execPath, [join(ROOT, "scripts", "audit-file-size.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { code: res.status ?? 1, out: (res.stdout || "") + (res.stderr || "") };
}

function resetFixture() {
  if (existsSync(FIXTURE_ABS)) rmSync(FIXTURE_ABS, { recursive: true, force: true });
  mkdirSync(join(FIXTURE_ABS, "functions", "_lib"), { recursive: true });
}

try {
  // ── (أ) الشجرة الحقيقية: تحذير بلا فشل، ويذكر الملفات القريبة من السقف اليوم ──
  {
    const real = runGuard();
    assert(real.code === 0, "الحارس يمرّ (كود خروج 0) على الشجرة الحقيقية رغم وجود ملفات قريبة من السقف");
    assert(/⚠.*يقترب من سقف/.test(real.out), "الحارس يطبع تحذير الاقتراب على الشجرة الحقيقية");
    assert(/persona\.js: 400 سطراً/.test(real.out), "التحذير يسرد persona.js (عند السقف تماماً، ٤٠٠) كمثال معروف اليوم");
  }

  // ── (ب) شجرة وهمية: ملف عند ٣٩٥ سطراً يُذكر بالاسم بالتحذير ──────────────
  {
    resetFixture();
    // لا \n زائدة بالنهاية: lineCount() بالحارس هو split("\n").length، فسطر أخير
    // فارغ بعد \n زائدة كان يزيد العدّ بواحد (٣٩٦ لا ٣٩٥).
    const nearCapLines = Array.from({ length: 395 }, (_, i) => `// line ${i}`).join("\n");
    writeFileSync(join(FIXTURE_ABS, "functions", "_lib", "near_cap.js"), nearCapLines);
    // ملف بعيد عن السقف — لا يجب أن يظهر بالتحذير.
    writeFileSync(join(FIXTURE_ABS, "functions", "_lib", "far_from_cap.js"), "// short\n");

    const fixture = runGuard({ AUDIT_SIZE_ROOT: FIXTURE });
    assert(fixture.code === 0, "الحارس يمرّ على الشجرة الوهمية (٣٩٥ سطراً لم تتجاوز سقف ٤٠٠)");
    assert(/⚠.*يقترب من سقف/.test(fixture.out), "الحارس يطبع تحذيراً على الشجرة الوهمية");
    assert(/near_cap\.js: 395 سطراً/.test(fixture.out), "التحذير يذكر اسم الملف الوهمي القريب من السقف بعدد أسطره");
    assert(!/far_from_cap\.js/.test(fixture.out), "الملف البعيد عن السقف لا يظهر بالتحذير");
  }

  // ── (ج) شجرة وهمية بلا أي ملف قريب من السقف — لا تحذير على الإطلاق ────────
  {
    resetFixture();
    writeFileSync(join(FIXTURE_ABS, "functions", "_lib", "tiny.js"), "// tiny\n");
    const fixture = runGuard({ AUDIT_SIZE_ROOT: FIXTURE });
    assert(fixture.code === 0, "الحارس يمرّ على شجرة بلا ملفات قريبة من السقف");
    assert(!/⚠.*يقترب من سقف/.test(fixture.out), "لا تحذير عند غياب أي ملف قريب من السقف");
  }
} finally {
  if (existsSync(FIXTURE_ABS)) rmSync(FIXTURE_ABS, { recursive: true, force: true });
}

done();
