// قراءة صورة منظّمة ومحفوظة (طلب المالك 2026-09-12: «كيف تخلي الجودة ثابتة مع تغير النماذج؟»).
//
// نفس التنورة قُرئت «قصّة واسعة» ثم «قصّة مستقيمة» بعد ست دقائق (Groq Qwen، 18:40 و18:46)، ومرة
// «إضاءة نهائية». ثلاث طبقات تثبّت ما يمكن تثبيته مهما تغيّر المزوّد:
//   ١) قارئ الصورة يختار كل صفة من قائمة مغلقة أو «غير واضح» — لا نص حر يختلف من نموذج لآخر،
//      وما خرج عن القائمة يُهمل لا يُنشر. بيانات التاجر (القصّة، الطول) تغلب قراءة الصورة.
//   ٢) الحقائق المتحقَّقة تُحفظ لكل صورة ولكل متجر (vision_facts): إعادة التوليد لا تعيد القراءة،
//      فلا تتقلب الصفات ولا تُستهلك حصة الرؤية.
//   ٣) الجملة الأولى وجدول المواصفات (والعنوان لاسم عام مثل «تنورة») يبنيها الكود من الحقائق؛
//      النموذج يكتب التنسيق والمناسبة فقط، وجملته التي تكرر الحقائق وحدها تُحذف.
// الفئات المغطاة: ملابس نسائية وعبايات (حيث رُصدت الأخطاء). غيرها يبقى على الملاحظات الحرة.
import { logError } from "../core/errorLog.js";
import { attributeCategoryFor } from "../ai/attributeDictionary.js";
import { fixColorAgreement, isBottomItem } from "./copyPhrases.js";

// تغيير القوائم أو الصيغة = رفع الإصدار، فتُقرأ الصور من جديد بدل حقائق بقوائم قديمة.
const FACTS_VERSION = "v2";
const STRUCTURED_CATEGORIES = new Set(["womens_apparel", "abayas"]);
const MIN_FACTS = 2;

const ENUMS = {
  length: ["ميني", "بطول الركبة", "ميدي", "ماكسي", "حتى الخصر", "تحت الخصر"],
  fit: ["واسعة", "مستقيمة", "ضيقة", "بقصّة A", "منسدلة", "كلوش"],
  waist: ["مرتفع", "منخفض", "بحزام", "مطاطي", "برباط"],
  neckline: ["دائرية", "على شكل V", "مربعة", "عالية", "ياقة قميص", "برباط", "على شكل قارب", "مكشوفة الكتفين", "ملفوفة"],
  sleeves: ["بلا أكمام", "بحمالات رفيعة", "قصيرة", "بطول الكوع", "طويلة", "منفوخة", "واسعة", "مكشكشة"],
  details: ["كسرات عريضة", "بليسيه", "طبقات", "كشكش", "دانتيل", "تطريز", "ترتر", "خرز", "فتحة جانبية", "أزرار", "جيوب", "حزام", "رباط", "درابيه", "تصميم غير متماثل", "سحاب ظاهر", "سموك"],
  surface: ["لامع", "مطفي", "شفاف"],
  pattern: ["سادة", "مورد", "مخطط", "كاروهات", "منقوش", "منقط"],
  mood: ["رسمي", "يومي", "سهرة", "نهاري", "مسائي"]
};
const LABELS = { color: "اللون", length: "الطول", fit: "القصّة", waist: "الخصر", neckline: "الياقة", sleeves: "الأكمام", details: "التفاصيل", surface: "سطح القماش", pattern: "النقشة", mood: "الطابع العام" };
const TOP_ONLY = ["neckline", "sleeves"];
// صيغ التفصيل كما تكتبها أسماء التجار: «عباية مطرزة» فيها «تطريز» فلا يتكرر.
const DETAIL_ALIASES = { "تطريز": ["تطريز", "مطرز"], "ترتر": ["ترتر", "مترتر"], "خرز": ["خرز", "مخرز"], "كشكش": ["كشكش", "مكشكش"], "كسرات عريضة": ["كسرات", "كسره"], "طبقات": ["طبقات", "طبقه"], "فتحة جانبية": ["فتحه"], "أزرار": ["ازرار"], "جيوب": ["جيوب", "جيب"], "تصميم غير متماثل": ["غير متماثل"], "سحاب ظاهر": ["سحاب"] };

// ياقة وأكمام يكتبها التاجر بصيغ أخرى: «فستان ميدي بصدر مربع وكم منفوش» لا تُتبع بـ«وياقة مربعة وأكمام منفوخة».
const NECK_IN_NAME = { "مربعة": ["صدر مربع", "ياقة مربعة", "رقبة مربعة"], "دائرية": ["ياقة دائرية", "رقبة دائرية"], "مكشوفة الكتفين": ["اوف شولدر", "كتف مكشوف", "مكشوف الكتف", "مكشوفة الكتفين"] };
const SLEEVE_IN_NAME = { "منفوخة": ["منفوش", "منفوخ"], "بلا أكمام": ["بدون اكمام", "بلا اكمام"], "طويلة": ["كم طويل", "اكمام طويلة"], "قصيرة": ["كم قصير", "اكمام قصيرة"], "واسعة": ["كم واسع", "اكمام واسعة"], "مكشكشة": ["كم مكشكش", "اكمام مكشكشة"] };

const norm = (t) => String(t || "").replace(/[ً-ْٰـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim().toLowerCase();

function canon(field, value) {
  if (typeof value !== "string") return null;
  const full = norm(value);
  const bare = full.replace(/^بقصه\s+/, "").replace(/^ال/, "");
  return ENUMS[field].find((e) => { const n = norm(e); return n === full || n === bare || n.replace(/^بقصه\s+/, "") === bare; }) || null;
}

const ITEM_WORD = /(?:تنور|فستان|فساتين|بلوز|عباي|قميص|بنطال|بنطلون|جاكيت|حذاء|حقيب|عارضه)/u;
function cleanColor(value) {
  const c = String(typeof value === "string" ? value : "").replace(/\s+/g, " ").trim();
  if (!/^[ء-ي٠-٩ّ ]{2,30}$/u.test(c) || norm(c) === norm("غير واضح") || c.split(" ").length > 3 || ITEM_WORD.test(norm(c))) return null;
  return c;
}

// بيانات التاجر أعلى ثقة من الصورة: فستان «كلوش» بمزاياه قرأه Qwen «ضيقة» (جولة ثبات 2026-09-12).
// القصّة تُؤخذ فقط بصيغة «قصة X» أو «كلوش» الصريحة (لا «أكمام واسعة»)، والطول بكلماته الصريحة.
function preferMerchant(facts, sourceText) {
  const src = norm(sourceText);
  if (!src) return facts;
  const f = { ...facts };
  const fitSaid = ENUMS.fit.filter((e) => {
    const t = norm(e).replace(/^بقصه\s+/, "");
    return t.length >= 3 && (new RegExp(`(?<!\\p{L})(?:ب)?قصه\\s+(?:ال)?${t}`, "u").test(src) || (t === "كلوش" && /(?<!\p{L})كلوش(?!\p{L})/u.test(src)));
  });
  if (fitSaid.length === 1) f.fit = fitSaid[0];
  const lengthSaid = ["ميني", "ميدي", "ماكسي"].filter((e) => new RegExp(`(?<!\\p{L})${e}(?!\\p{L})`, "u").test(src));
  if (lengthSaid.length === 1) f.length = lengthSaid[0];
  return f;
}

/** null = المخرج ليس JSON (ملاحظات حرة)؛ وإلا الحقائق الصالحة وحدها (قد تكون {}). */
function parseVisionFacts(input, name = "", sourceText = "") {
  let j = input;
  if (typeof input === "string") {
    const start = input.indexOf("{");
    const end = input.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try { j = JSON.parse(input.slice(start, end + 1)); } catch { return {}; }
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return {};
  const bottom = isBottomItem(name);
  const facts = {};
  const color = cleanColor(j.color);
  if (color) facts.color = color;
  for (const field of Object.keys(ENUMS)) {
    if (bottom && TOP_ONLY.includes(field)) continue;
    if (field === "details") {
      const raw = Array.isArray(j.details) ? j.details : typeof j.details === "string" ? j.details.split(/[،,]/) : [];
      const list = [...new Set(raw.map((d) => canon("details", d)).filter(Boolean))].slice(0, 4);
      if (list.length) facts.details = list;
    } else {
      const c = canon(field, j[field]);
      if (c) facts[field] = c;
    }
  }
  return Object.keys(facts).length ? preferMerchant(facts, `${name} ${sourceText}`) : facts;
}

const enough = (facts) => Boolean(facts) && Object.keys(facts).length >= MIN_FACTS;

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** هل تُقرأ الصورة منظّمة، ومفتاح حفظها، وحقائقها المحفوظة إن وُجدت. عطل D1 = قراءة جديدة. */
export async function visionFactsContext(env, { merchantId, imageUrl, name, category, sourceText = "" }) {
  const structured = Boolean(imageUrl) && STRUCTURED_CATEGORIES.has(attributeCategoryFor({ category, name }));
  const ctx = { structured, key: null, facts: null, sourceText };
  if (!structured || !merchantId) return ctx;
  ctx.key = await sha256Hex(`${FACTS_VERSION}|${imageUrl}|${String(name || "").trim()}`);
  if (!env?.DB) return ctx;
  try {
    const row = await env.DB.prepare("SELECT facts FROM vision_facts WHERE merchant_id = ? AND image_key = ?").bind(merchantId, ctx.key).first();
    // بيانات التاجر تُطبَّق عند القراءة أيضاً: تعديل التاجر لمزاياه بعد الحفظ يسري فوراً.
    const facts = row?.facts ? parseVisionFacts(JSON.parse(row.facts), name, sourceText) : null;
    if (enough(facts)) ctx.facts = facts;
  } catch { /* الجدول غير مطبَّق أو عطل D1: تُقرأ الصورة من جديد */ }
  return ctx;
}

/** صيغة الإخراج المنظّمة تُلحق بتوجيه قارئ الصورة. */
export function structuredVisionBlock(ctx, name = "") {
  if (!ctx?.structured) return "";
  const bottom = isBottomItem(name);
  const fields = Object.keys(ENUMS).filter((k) => !(bottom && TOP_ONLY.includes(k)));
  return [
    "",
    "## صيغة الإخراج — تستبدل صيغة الأسطر أعلاه",
    "أرجع JSON واحداً فقط بلا أي نص قبله أو بعده. كل قيمة حرفياً من قائمتها، أو «غير واضح» عند أدنى شك — لا تخمين ولا قيمة من خارج القائمة:",
    "- color: اسم اللون بالعربي بصيغة المذكر (أسود، وردي فاتح، كحلي)",
    ...fields.map((k) => `- ${k}${k === "details" ? " (قائمة من ٠ إلى ٤ عناصر)" : ""}: ${ENUMS[k].join(" | ")}`),
    "- الصفات للقطعة المعروضة للبيع وحدها، لا لما تلبسه العارضة معها.",
    "- fit: «واسعة» إن اتسعت الحافة عن الخصر، «مستقيمة» إن بقي عرضها قريباً من الخصر، «ضيقة» إن التصق القماش بالجسم.",
    "- details: «تطريز» خيوط بارزة مخيطة فوق القماش؛ الرسم المطبوع (ورود، أشكال) نقشة في pattern لا تطريز. «تصميم غير متماثل» إن اختلف طرفا القطعة أو تراكبت طبقة مائلة. «سموك» تجعيد مطاطي كثيف عند الخصر أو الياقة أو الأساور. «أزرار» إن ظهرت صف أزرار. «حزام» شريط منفصل يلتف حول الخصر فقط؛ قماش الفستان نفسه ملفوفاً أو معقوداً عند الخصر «درابيه» لا حزام.",
    "- color: إن كان بالقطعة لونان رئيسيان (كاروهات أو مخطط أو قطعتان) اذكرهما معاً «أحمر وأسود»، لا الأوضح وحده.",
    `الصيغة: {${["color", ...fields].map((k) => `"${k}": ${k === "details" ? "[…]" : "\"…\""}`).join(", ")}}`
  ].join("\n");
}

/**
 * يحوّل مخرج قارئ الصورة إلى ملاحظات من الحقائق الصالحة ويحفظها.
 * null = ليست قراءة منظّمة (تبقى الملاحظات الحرة)؛ "" = JSON بلا حقائق كافية (لا ملاحظات).
 */
export async function settleVisionFacts(env, ctx, { merchantId, name, text, model }) {
  if (!ctx?.structured) return null;
  const facts = parseVisionFacts(text, name, ctx.sourceText || "");
  if (facts === null) return null;
  if (!enough(facts)) {
    logError({ env }, { requestId: null, path: "api/copy:vision", code: "VISION_FACTS_INVALID", internal: `model=${model || "?"} ${String(text || "").slice(0, 300).replace(/\s+/g, " ")}`, storeId: merchantId });
    return "";
  }
  ctx.facts = facts;
  if (env?.DB && ctx.key && merchantId) {
    try {
      await env.DB.prepare(
        "INSERT INTO vision_facts (merchant_id, image_key, facts, model) VALUES (?, ?, ?, ?) ON CONFLICT(merchant_id, image_key) DO UPDATE SET facts = excluded.facts, model = excluded.model, created_at = datetime('now')"
      ).bind(merchantId, ctx.key, JSON.stringify(facts), String(model || "")).run();
    } catch { /* الحفظ تثبيت لا شرط: فشله لا يُسقط التوليد */ }
  }
  return factsToNotes(facts);
}

/** ملاحظات بنفس صيغة الأسطر السابقة، فتعمل عليها الحراس والدروس كما هي. */
export function factsToNotes(facts) {
  const f = facts || {};
  return Object.keys(LABELS)
    .filter((k) => (k === "details" ? f.details?.length : f[k]))
    .map((k) => `${LABELS[k]}: ${k === "details" ? f.details.join("، ") : f[k]}.`)
    .join(" ");
}

const isFeminineItem = (noun) => fixColorAgreement(`${noun} أسود`) !== `${noun} أسود`;
function agreeOneColor(noun, color) {
  const agreed = fixColorAgreement(`${noun} ${color}`).slice(noun.length + 1);
  if (agreed === color) return color;
  return agreed.replace(/(?<!\p{L})(فاتح|غامق)(?!\p{L})/u, "$1ة");
}
// لونان بواو العطف: «تنورة سوداء وأبيض» ⇒ «سوداء وبيضاء» (2026-09-13). «وردي» كلمة واحدة لا عطف.
const colorParts = (color) => color.split(/\s+و(?=\p{L})/u);
function agreeColor(noun, color) {
  // «تنورة متعدد الألوان» (2026-09-13): «متعدد» ليس بجدول ألوان copyPhrases فلا يؤنَّث هناك.
  if (isFeminineItem(noun)) color = color.replace(/^متعدد(?=\s)/u, "متعددة");
  return colorParts(color).map((c) => agreeOneColor(noun, c)).join(" و");
}
const definite = (color) => colorParts(color).map((c) => c.split(" ").map((w) => (w.startsWith("ال") ? w : `ال${w}`)).join(" ")).join(" و");
const LENGTH_PHRASE = (l) => (l.startsWith("بطول") ? l : `بطول ${l}`);
const WAIST = { "مرتفع": "بخصر مرتفع", "منخفض": "بخصر منخفض", "بحزام": "بحزام عند الخصر", "مطاطي": "بخصر مطاطي", "برباط": "برباط عند الخصر" };
const NECK = (v) => (v === "ياقة قميص" ? "بياقة قميص" : v === "مكشوفة الكتفين" ? "بكتفين مكشوفين" : `بياقة ${v}`);
const SLEEVE = (v) => (["بلا أكمام", "بحمالات رفيعة"].includes(v) ? v : `بأكمام ${v}`);
const DETAIL = (d) => (d === "بليسيه" ? "طيّات بليسيه" : d === "سموك" ? "تجعيد سموك" : d);
// النقشة أوضح ما بصورة تنورة ورود — كانت تُترك للمواصفات وحدها. «سادة» لا تُذكر بالجملة الأولى.
// «منقوش» عامة لا تصف شيئاً («بنقوش وقماش مطفي»، 2026-09-13) — تبقى بالمواصفات لا بالجملة.
const PATTERN = { "مورد": "نقشة مورّدة", "مخطط": "نقشة مخططة", "كاروهات": "نقشة كاروهات", "منقط": "نقاط" };
const FIT = (v) => (v.startsWith("بقصّة") ? v : `بقصّة ${v}`);
// «بقصّة واسعة وخصر مرتفع»: الأولى بالباء، والتالية بالواو (و«بلا» تبقى «وبلا»).
const chain = (list) => list.map((p, i) => {
  const b = p.startsWith("ب") ? p : `ب${p}`;
  return i === 0 ? b : `و${b.startsWith("بلا ") ? b : b.slice(1)}`;
}).join(" ");

function factsCopy(facts, name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { opening: "", title: "" };
  const inName = (terms) => terms.some((t) => norm(words.join(" ")).includes(norm(t)));
  const f = facts || {};
  const lengthNew = f.length && !inName([f.length.replace(/^بطول\s+/, "")]);
  const colorNew = f.color && !inName([f.color.split(" ")[0]]);
  // اسم عام («تنورة»): «تنورة ميدي سوداء». اسم التاجر المفصّل يبقى كما كتبه، والحقائق بعده: «… باللون الأسود وطول ماكسي».
  const short = words.length <= 2;
  const head = short
    ? [words[0], ...(lengthNew ? [f.length] : []), ...(colorNew ? [agreeColor(words[0], f.color)] : []), ...words.slice(1)].join(" ")
    : words.join(" ");
  const cuts = [
    ...(!short && colorNew ? [`باللون ${definite(f.color)}`] : []),
    ...(!short && lengthNew ? [LENGTH_PHRASE(f.length)] : []),
    ...(f.fit && !inName([f.fit.replace(/^بقصّة\s+/, "")]) ? [FIT(f.fit)] : []),
    ...(f.waist ? [WAIST[f.waist]] : []),
    ...(f.neckline && !inName(NECK_IN_NAME[f.neckline] || [`ياقة ${f.neckline}`]) ? [NECK(f.neckline)] : []),
    ...(f.sleeves && !inName(SLEEVE_IN_NAME[f.sleeves] || [`اكمام ${f.sleeves}`]) ? [SLEEVE(f.sleeves)] : [])
  ];
  // «بحزام عند الخصر» ثم «بطبقات وحزام»: التفصيل المكرر من الخصر لا يُعاد.
  const details = (f.details || []).filter((d) => !inName(DETAIL_ALIASES[d] || [d]) && !(d === "حزام" && f.waist === "بحزام") && !(d === "رباط" && f.waist === "برباط"));
  const pattern = PATTERN[f.pattern] && !inName([f.pattern]) ? [PATTERN[f.pattern]] : [];
  const extras = [...details.map(DETAIL), ...pattern, ...(f.surface ? [`قماش ${f.surface}`] : [])];
  const opening = `${head}${cuts.length ? ` ${chain(cuts)}` : ""}${extras.length ? `${cuts.length ? "،" : ""} ${chain(extras)}` : ""}.`;
  const lead = details[0] ? `ب${DETAIL(details[0])}` : f.fit && !inName([f.fit]) ? FIT(f.fit) : "";
  const title = `${head}${lead ? ` ${lead}` : ""}`.slice(0, 60).trim();
  return { opening, title };
}

// كلمة مجردة للمقارنة: بلا تشكيل ولا واو عطف ولا باء جر ولا «ال».
const bareWord = (w) => norm(w).replace(/[^\p{L}]/gu, "").replace(/^و(?=\p{L}{3,})/u, "").replace(/^ب(?=\p{L}{3,})/u, "").replace(/^ال(?=\p{L}{2,})/u, "");
const ECHO_STOP = new Set(["مع", "في", "من", "على", "ذات", "ذو", "و"]);

/** الجملة الأولى والمواصفات (والعنوان ونص البديل لاسم عام) من الحقائق المحفوظة. */
export function applyVisionFacts(parsed, facts, { name = "" } = {}) {
  if (!enough(facts)) return parsed;
  const { opening, title } = factsCopy(facts, name);
  const cw = parsed.copywriting || (parsed.copywriting = {});
  if (opening) {
    const paras = String(cw.description || "").trim().split(/\n\s*\n/);
    const sentences = (paras[0] || "").split(/(?<=[.!؟])\s+/).filter(Boolean);
    const noun = norm(String(name).trim().split(/\s+/)[0] || "");
    // جملة النموذج الأولى تبدأ باسم المنتج = جملة الحقائق عنده؛ تُستبدل. غير ذلك تُسبق بجملة الحقائق.
    if (sentences.length && noun && norm(sentences[0]).startsWith(noun)) sentences[0] = opening; else sentences.unshift(opening);
    // «السطح مطفي والنقشة سادة، مع أكمام واسعة.» (عباية، جولة ثبات 2026-09-12): جملة لا تضيف كلمة واحدة
    // خارج الحقائق وعناوينها واسم المنتج تكرار — تُحذف.
    const known = new Set([...Object.values(LABELS), String(name), ...Object.values(facts).flat()].flatMap((t) => String(t).split(/\s+/)).map(bareWord));
    // «يمتاز الفستان بتفاصيل بليسيه وكشكش وطبقات تمنحه مظهراً نهارياً» (2026-09-13): كلمات حشو قليلة حول الحقائق
    // نفسها تكرار أيضاً — نصف كلماتها أو أكثر حقائق، وما يضيفه ثلاث كلمات فأقل.
    const echo = (s) => {
      const content = s.split(/\s+/).map(bareWord).filter((w) => w && !ECHO_STOP.has(w));
      const novel = content.filter((w) => !known.has(w) && !known.has(w.replace(/(?:ا|ه)$/u, "")));
      return novel.length <= 1 || (content.length >= 4 && novel.length <= 3 && novel.length * 2 <= content.length);
    };
    paras[0] = [sentences[0], ...sentences.slice(1).filter((s) => !echo(s))].join(" ");
    cw.description = paras.filter((p) => p.trim()).join("\n\n");
  }
  const FACT_KEY = /(لون|طول|قص|خصر|ياق|اكمام|تفاصيل|سطح|نقش|طابع)/u;
  const kept = (Array.isArray(parsed.specsTable) ? parsed.specsTable : []).filter((r) => r && !FACT_KEY.test(norm(r.key)));
  const rows = Object.keys(LABELS)
    .filter((k) => k !== "mood" && (k === "details" ? facts.details?.length : facts[k]))
    .map((k) => ({ key: LABELS[k], value: k === "details" ? facts.details.join("، ") : facts[k] }));
  parsed.specsTable = [...rows, ...kept];
  if (title && String(name).trim().split(/\s+/).length <= 2) {
    const seo = parsed.seo || (parsed.seo = {});
    seo.title = title;
    parsed.imageAlt = title;
  }
  return parsed;
}
