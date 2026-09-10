// هالة داخل إطار لوحة سلة — بنود دليل تصميم التطبيقات المضمّنة الإلزامية.
//
// أُضيف 2026-09-10 قبل تقديم سلة. يحرس: لا شريط/تذييل خاص بنا داخل الإطار،
// العنوان بشريط سلة، اتباع الوضع الداكن، وتأكيد وإشعار بأدوات سلة — مع بقاء
// السلوك خارج الإطار كما كان.
import { readFileSync } from "node:fs";
import { createRunner } from "../_helpers.mjs";

const { assert, done } = createRunner("embedded-shell");
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

/** بيئة متصفح وهمية: إطار (self≠top) أو زيارة مباشرة، مع SDK يسجّل النداءات. */
function fakeBrowser({ framed = true, confirmResult = true, confirmThrows = false } = {}) {
  const calls = { title: [], toast: [], confirm: [], native: [], nativeConfirm: 0 };
  const classes = new Set();
  let themeCb = null;
  const self = {};
  globalThis.document = {
    documentElement: { classList: { toggle: (c, on) => { on ? classes.add(c) : classes.delete(c); } } }
  };
  globalThis.window = {
    self,
    top: framed ? {} : self,
    showToast: (t, k) => calls.native.push([t, k]),
    confirm: () => { calls.nativeConfirm++; return false; },
    salla: {
      embedded: {
        onThemeChange: (cb) => { themeCb = cb; return () => { themeCb = null; }; },
        page: { setTitle: (t) => calls.title.push(t) },
        ui: {
          toast: {
            success: (m) => calls.toast.push(["success", m]),
            error: (m) => calls.toast.push(["error", m]),
            warning: (m) => calls.toast.push(["warning", m]),
            info: (m) => calls.toast.push(["info", m])
          },
          confirm: async (o) => { calls.confirm.push(o); if (confirmThrows) throw new Error("x"); return { confirmed: confirmResult }; }
        }
      }
    }
  };
  return { calls, classes, emitTheme: (t) => themeCb && themeCb(t) };
}

let seq = 0;
const fresh = () => import(`../../public/js/dashboard/embedded.js?v=${++seq}`);

async function main() {
  // ── داخل الإطار ────────────────────────────────────────────────────────
  {
    const b = fakeBrowser({ framed: true });
    const m = await fresh();
    m.onEmbeddedInit({ theme: "dark" });
    assert(b.classes.has("salla-dark"), "EMB-1: الوضع الداكن من init يُطبَّق فوراً");
    b.emitTheme("light");
    assert(!b.classes.has("salla-dark"), "EMB-2: تغيّر الوضع في سلة يُتابَع (onThemeChange)");

    m.setEmbeddedTitle(m.TAB_TITLES.store);
    assert(b.calls.title.at(-1) === "هالة · متجري", "EMB-3: العنوان يُرسل لشريط سلة الأصلي");
    m.setEmbeddedTitle("   ");
    assert(b.calls.title.length === 1, "EMB-4: عنوان فارغ لا يُرسل (SDK يرفضه)");

    window.showToast("تم", "success");
    window.showToast("نوع غريب", "weird");
    assert(
      b.calls.toast[0][0] === "success" && b.calls.toast[1][0] === "info" && b.calls.native.length === 0,
      "EMB-5: الإشعار بأداة سلة داخل الإطار، والنوع المجهول يصير info"
    );

    const ok = await m.confirmAction({ title: "ت", message: "متأكد؟", variant: "danger" });
    assert(ok === true && b.calls.confirm[0].variant === "danger" && b.calls.nativeConfirm === 0, "EMB-6: التأكيد بنافذة سلة لا بنافذة المتصفح");
    await m.confirmAction({ title: "ت", message: "م", variant: "nope" });
    assert(b.calls.confirm[1].variant === "warning", "EMB-7: متغيّر مجهول يصير warning (SDK يرفض غيره)");
  }
  {
    const b = fakeBrowser({ framed: true, confirmResult: false });
    const m = await fresh();
    m.onEmbeddedInit({ theme: "light" });
    assert((await m.confirmAction({ title: "ت", message: "م" })) === false, "EMB-8: الإلغاء في نافذة سلة يرجّع false — لا حذف");
  }
  {
    const b = fakeBrowser({ framed: true, confirmThrows: true });
    const m = await fresh();
    m.onEmbeddedInit({ theme: "light" });
    await m.confirmAction({ title: "ت", message: "م" });
    assert(b.calls.nativeConfirm === 1, "EMB-9: فشل SDK يسقط لنافذة المتصفح — لا قبول صامت");
  }

  // ── خارج الإطار: السلوك كما كان ───────────────────────────────────────
  {
    const b = fakeBrowser({ framed: false });
    const m = await fresh();
    m.onEmbeddedInit({ theme: "dark" });
    m.setEmbeddedTitle("منتجاتي ووصفها");
    window.showToast("تم", "success");
    await m.confirmAction({ title: "ت", message: "م" });
    assert(b.calls.title.length === 0 && b.calls.toast.length === 0, "EMB-10: زيارة مباشرة لا تنادي SDK سلة");
    assert(b.calls.native.length === 1 && b.calls.nativeConfirm === 1, "EMB-11: زيارة مباشرة تستخدم الشريط ونافذة المتصفح كما كانا");
  }
  {
    const b = fakeBrowser({ framed: true });
    const m = await fresh();
    m.setEmbeddedTitle("منتجاتي");
    assert(b.calls.title.length === 0, "EMB-12: قبل نجاح init لا نداء لـSDK");
  }

  // ── توصيل الصفحة ───────────────────────────────────────────────────────
  {
    const head = read("../../partials/dashboard-head.html");
    const nav = read("../../partials/dashboard-nav.html");
    const dash = read("../../dashboard.html");
    const main = read("../../public/js/dashboard/main.js");
    const tabs = read("../../public/js/dashboard/tabs.js");

    assert(/@salla\.sa\/embedded-sdk@0\.2\.6\/dist\/umd\/index\.js/.test(head), "EMB-13: إصدار SDK مثبّت — لا «آخر إصدار» يغيّر أشكال الدوال بصمت");
    const iMark = head.indexOf('classList.add("in-salla-frame")');
    const iTailwind = head.indexOf("cdn.tailwindcss.com");
    assert(iMark > 0 && iMark < iTailwind, "EMB-14: وسم الإطار قبل أي رسم — لا وميض للشريط");
    assert(
      /\.in-salla-frame #dashNav,\s*\n\s*\.in-salla-frame #dashFooter \{ display: none !important; \}/.test(head) &&
        /id="dashNav"/.test(nav) && /id="dashFooter"/.test(dash),
      "EMB-15: الشريط والتذييل مخفيان داخل الإطار (لا تكرار لتنقّل لوحة سلة)"
    );
    for (const cls of ["bg-white", "text-black", "border-slate-200", "sleek-card", "sleek-btn-black", "tab-on"]) {
      assert(new RegExp(`\\.salla-dark \\.${cls}\\b`).test(head), `EMB-16/${cls}: مغطّى بالوضع الداكن`);
    }
    assert(/\.salla-dark input,/.test(head), "EMB-16/inputs: الحقول مقروءة بالوضع الداكن");
    assert(
      /const \{ layout \} = await window\.salla\.embedded\.init/.test(main) && /onEmbeddedInit\(layout\)/.test(main),
      "EMB-17: الوضع من init يصل لـembedded.js"
    );
    assert(/setEmbeddedTitle\(TAB_TITLES\[tab\]\)/.test(tabs), "EMB-18: العنوان يتبع التبويب");

    const js = ["store.js", "review.js", "catalog.js", "studio.js", "account.js", "bulk.js", "main.js"]
      .map((f) => read(`../../public/js/dashboard/${f}`)).join("\n");
    assert(!/window\.confirm\(|[^.\w]confirm\(/.test(js), "EMB-19: لا window.confirm بلوحة التاجر — قد يُحجب داخل إطار سلة");
    assert(
      /confirmAction\(\{[\s\S]{0,200}variant: "warning"/.test(read("../../public/js/dashboard/review.js")),
      "EMB-20: «تراجع» يؤكد بنافذة سلة"
    );
  }
}

main().then(done);
