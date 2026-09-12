// أيقونات لوحة التاجر من Hugeicons Free — بند إلزامي بدليل تصميم تطبيقات سلة.
//
// أُضيف 2026-09-10. يحرس: لا عودة لـMaterial Symbols بلوحة التاجر، كل أيقونة
// SVG مضمَّن يتبع لون النص وحجمه، إشعار ترخيص MIT مشحون مع الأيقونات، وحالة
// «جاري السحب» الديناميكية لم تنكسر بالاستبدال (كانت تكتب اسم الخط بـinnerText).
import { readFileSync } from "node:fs";
import { createRunner } from "../_helpers.mjs";

const { assert, done } = createRunner("hugeicons");
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const PARTIALS = ["dashboard-catalog", "dashboard-hero", "dashboard-modals", "dashboard-nav", "dashboard-review", "dashboard-store", "dashboard-studio", "dashboard-bulk"];
const NAMES = ["check_circle", "auto_awesome", "storefront", "refresh", "close", "tune", "sync", "progress_activity", "logout",
  "lock_person", "link_off", "label_important", "image_not_supported", "edit_note", "edit", "delete_forever", "inventory_2"];

async function main() {
  const html = PARTIALS.map((p) => read(`../../partials/${p}.html`)).join("\n") + read("../../dashboard.html");
  const js = ["catalog.js", "studio.js", "review.js", "store.js", "account.js", "main.js", "tabs.js", "render.js", "bulk.js"]
    .map((f) => read(`../../public/js/dashboard/${f}`)).join("\n");

  assert(!/material-symbols-outlined/.test(html) && !/material-symbols-outlined/.test(js), "HGI-1: لا أيقونة Material Symbols بلوحة التاجر");

  const svgs = html.match(/<svg[^>]*class="hgi[^"]*"[^>]*>[\s\S]*?<\/svg>/g) || [];
  assert(svgs.length >= 25, `HGI-2: كل مواضع الأيقونات صارت SVG مضمَّناً (${svgs.length})`);
  assert(
    svgs.every((s) => /viewBox="0 0 24 24"/.test(s) && /width="1em"/.test(s) && /aria-hidden="true"/.test(s)),
    "HGI-3: كل SVG بمقاس 1em (يتبع صنف النص) ومخفي عن قارئ الشاشة"
  );
  assert(
    svgs.every((s) => /currentColor/.test(s) && !/#[0-9a-f]{3,6}"/i.test(s)),
    "HGI-4: اللون currentColor لا ألوان ثابتة — يتبع النص والوضع الداكن"
  );

  const icons = read("../../public/js/dashboard/icons.js");
  assert(
    /MIT License/.test(icons) && /Copyright \(c\) Hugeicons/.test(icons) && /@hugeicons\/core-free-icons@4\.3\.2/.test(icons) &&
      /The above copyright notice and this permission notice shall be included/.test(icons),
    "HGI-5: إشعار ترخيص MIT كاملاً مشحون مع الأيقونات"
  );

  // سلوكي: الدوال تُنتج SVG صالحاً لكل اسم مستخدم، وفارغاً لاسم مجهول.
  const { iconSvg, setIcon } = await import("../../public/js/dashboard/icons.js");
  assert(NAMES.every((n) => /^<svg[\s\S]*<\/svg>$/.test(iconSvg(n))), "HGI-6: كل الأسماء السبعة عشر لها أيقونة");
  assert(iconSvg("does_not_exist") === "", "HGI-7: اسم مجهول لا يُنتج وسماً مكسوراً");
  assert(/class="hgi text-3xl text-slate-400"/.test(iconSvg("image_not_supported", "text-3xl text-slate-400")), "HGI-8: الأصناف تُمرَّر للحجم واللون");
  const el = { innerHTML: "" };
  setIcon(el, "sync");
  assert(/<svg/.test(el.innerHTML), "HGI-9: setIcon يبدّل محتوى الحاوي");

  // حالة «جاري السحب» الديناميكية: الحاوي باقٍ بمعرّفه، وJS لا يكتب اسم خط.
  const catalogPartial = read("../../partials/dashboard-catalog.html");
  const catalog = read("../../public/js/dashboard/catalog.js");
  assert(/<span id="catalogEmptyIcon" class="inline-flex[^"]*"><svg/.test(catalogPartial), "HGI-10: حاوي أيقونة الحالة الفارغة باقٍ بمعرّفه");
  assert(
    /setIcon\(icon, "sync"\)/.test(catalog) && !/icon\.innerText = "(sync|inventory_2)"/.test(catalog),
    "HGI-11: الحالة الفارغة تبدّل الأيقونة بـsetIcon لا بكتابة اسم خط كنص"
  );
}

main().then(done);
