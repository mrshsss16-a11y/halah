// tests/unit/safe-description-html.test.mjs — safeDescriptionHtml (reviewSections.js), DESIGN_SPEC §3/§8:
// وصف سلة الحالي («قبل» بنافذة المراجعة) يُعرض كـHTML، لا نص خام — لازم يُصفّى بقائمة سماح صارمة:
// وسوم غير مسموحة تُفكّ (يبقى محتواها لا وسمها)، script/style/iframe/… تُحذف كاملة (محتوى وكل شيء)،
// وكل خاصية HTML (onclick, href, src, style, class…) تُزال من كل وسم يبقى.
// Node بلا DOMParser ⇒ يمرّ بالمسار البديل النصي (نفس القواعد بلا DOM) — هذا ما يختبره هذا الملف فعلياً.
import { createRunner } from "../_helpers.mjs";
import { safeDescriptionHtml } from "../../public/js/dashboard/reviewSections.js";

const { assert, done } = createRunner("safe-description-html");

async function main() {
  assert(typeof DOMParser === "undefined", "SD-0: (افتراض البيئة) Node بلا DOMParser — يختبر المسار البديل فعلاً");

  assert(safeDescriptionHtml("") === "" && safeDescriptionHtml(null) === "" && safeDescriptionHtml(undefined) === "", "SD-1: مدخل فارغ ⇒ خرج فارغ");

  {
    const got = safeDescriptionHtml("<p>نص عادي</p>");
    assert(got === "<p>نص عادي</p>", `SD-2: وسم مسموح بلا خصائص يبقى كما هو («${got}»)`);
  }

  {
    const got = safeDescriptionHtml('<p class="x" style="color:red" onclick="alert(1)">نص</p>');
    assert(got === "<p>نص</p>" && !/class=|style=|onclick=/.test(got), `SD-3: كل خصائص الوسم المسموح تُزال («${got}»)`);
  }

  {
    const got = safeDescriptionHtml('<div class="wrap"><p>محتوى</p></div>');
    assert(got === "<p>محتوى</p>" && !/<div/.test(got), `SD-4: وسم خارج القائمة يُفكّ ويبقى محتواه («${got}»)`);
  }

  {
    const got = safeDescriptionHtml('قبل<script>alert(document.cookie)</script>بعد');
    assert(!/<script/i.test(got) && !/alert/.test(got) && /قبل/.test(got) && /بعد/.test(got), `SD-5: <script> يُحذف كاملاً (وسم ومحتوى) («${got}»)`);
  }

  {
    const got = safeDescriptionHtml('<a href="javascript:alert(1)" onclick="x()">رابط</a>');
    assert(!/<a/.test(got) && !/href=/.test(got) && !/onclick=/.test(got) && /رابط/.test(got), `SD-6: <a> غير مسموح يُفكّ وتُحذف كل خصائصه («${got}»)`);
  }

  {
    const got = safeDescriptionHtml('<table><thead><tr><th>الخاصية</th></tr></thead><tbody><tr><td onclick="x()">قيمة</td></tr></tbody></table>');
    assert(/<table><thead><tr><th>الخاصية<\/th><\/tr><\/thead><tbody><tr><td>قيمة<\/td><\/tr><\/tbody><\/table>/.test(got), `SD-7: جدول (table/thead/tbody/tr/th/td) يُبنى بلا خصائص («${got}»)`);
  }

  {
    const got = safeDescriptionHtml('<p>سطر أول<br>سطر ثاني</p><ul><li>نقطة</li></ul>');
    assert(/<br>/.test(got) && /<ul><li>نقطة<\/li><\/ul>/.test(got), `SD-8: br وul/li يبقون («${got}»)`);
  }

  {
    const got = safeDescriptionHtml('<strong>غامق</strong> و<em>مائل</em> و<b>ب</b> و<i>ط</i>');
    assert(got === "<strong>غامق</strong> و<em>مائل</em> و<b>ب</b> و<i>ط</i>", `SD-9: strong/em/b/i تبقى («${got}»)`);
  }

  {
    const got = safeDescriptionHtml('<style>body{color:red}</style><iframe src="//evil"></iframe><object></object><embed><form><input></form>');
    assert(!/style|iframe|object|embed|form|input/i.test(got), `SD-10: style/iframe/object/embed/form/input تُحذف كاملة («${got}»)`);
  }

  {
    // خطر حقن حقيقي: وسم غير مغلق أو محاولة كسر القائمة بحروف كبيرة/خليط حالة.
    const got = safeDescriptionHtml('<SCRIPT>alert(1)</SCRIPT><DIV onclick="x()">نص</DIV>');
    assert(!/script/i.test(got) && !/<div/i.test(got) && !/onclick/i.test(got) && /نص/.test(got), `SD-11: حالة الأحرف لا تتجاوز الفلترة («${got}»)`);
  }

  {
    // SEC-7 (2026-09-17): math/noscript/template تُحذف كاملة — لا تُفكّ كوسم عادي يبقى محتواه.
    const got = safeDescriptionHtml('قبل<math><mtext>x</mtext></math><noscript><img src=x onerror=alert(1)></noscript><template><script>alert(2)</script></template>بعد');
    assert(!/math|mtext|noscript|template/i.test(got) && !/<img/i.test(got) && !/<script/i.test(got) && /قبل/.test(got) && /بعد/.test(got), `SD-12: math/noscript/template تُحذف كاملة بمحتواها («${got}»)`);
  }
}

main().then(done);
