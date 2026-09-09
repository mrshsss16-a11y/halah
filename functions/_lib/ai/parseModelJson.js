/**
 * انتزاع JSON من مخرج نموذج لغوي — مكان واحد لكل القنوات.
 *
 * نُقل من `api/copy.js` بالمرحلة ٤ (ARCHITECTURE §٢) بلا تغيير سلوكي، ثم صار
 * `chat.js` يستخدمه بدل الـregex الجشع الذي كان عنده.
 */

/**
 * A4 — انتزاع JSON **متوازن الأقواس**.
 *
 * البديل السابق كان `source.match(/\{[\s\S]*\}/)` — جشع: يبتلع من أول `{`
 * بالمخرج إلى آخر `}` فيه، فأي جملة تمهيدية فيها قوس، أو كتلتا JSON، تنتج
 * نصاً غير صالح ⇒ فشل التحليل ⇒ (بالسلوك القديم) نشر النص الخام كوصف منتج.
 *
 * هنا: أول `{` ثم مسح بعدّاد عمق يحترم السلاسل النصية وهروب المحارف.
 */
export function extractBalancedJson(source) {
  const text = typeof source === "string" ? source : String(source ?? "");
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const scan = fenced ? fenced[1] : text;

  const start = scan.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < scan.length; i++) {
    const ch = scan[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { if (inString) escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return scan.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * نفس الانتزاع ثم `JSON.parse`، ويرجّع `null` عند أي فشل بدل الرمي.
 *
 * هذا هو ما يحتاجه مسار المحادثة: مخرج غير قابل للتحليل هناك ليس خطأً بل
 * ارتداداً لنص الرد كما هو (السلوك القائم بـ`chat.js`)، خلافاً لمسار الوصف
 * الذي يرمي `CopyParseError` عمداً (§١١).
 */
export function parseModelJson(source) {
  const jsonString = extractBalancedJson(source);
  if (!jsonString) return null;
  try {
    return JSON.parse(jsonString);
  } catch {
    return null;
  }
}
