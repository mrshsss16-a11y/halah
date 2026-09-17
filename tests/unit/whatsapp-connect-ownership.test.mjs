// 2026-09-17: SEC-1 — `phoneNumberId` كان يُحفظ بلا إثبات أن التوكن المتبادَل
// يملكه. هذه الاختبارات تقفل السلوك: رقم ضمن الـWABA ينجح ويُحفظ، رقم غريب
// يُرفض 403 بلا حفظ، وفشل غراف يعطي 502 بلا حفظ — ولا سطر سجل يحمل التوكن.
import { createRunner } from "../_helpers.mjs";
import { connectWhatsappNumber } from "../../functions/_lib/domain/whatsappConnect.js";

const { assert, done } = createRunner("whatsapp-connect-ownership");

const TOKEN = "EAAtest-business-token-SECRET-1234567890";

function createEnv() {
  const inserts = [];
  return {
    inserts,
    env: {
      META_APP_ID: "812182698552804",
      META_APP_SECRET: "app-secret",
      ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
      DB: {
        prepare(sql) {
          return {
            bind: (...args) => ({
              run: async () => {
                inserts.push({ sql, args });
                return { success: true };
              }
            })
          };
        }
      }
    }
  };
}

function jsonRes(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

/** يركّب fetch وهمياً حسب مسار الطلب، ويسجّل كل الروابط المطلوبة. */
function installFetch(routes, calls) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    for (const [match, res] of routes) {
      if (u.includes(match)) return typeof res === "function" ? res(u) : res;
    }
    return jsonRes({ error: "unexpected" }, false, 500);
  };
}

const logs = [];
const origError = console.error;
console.error = (...args) => {
  logs.push(args.map((a) => String(a)).join(" "));
  origError(...args); // تمرير: لا نُخفي أسطر FAIL خلف الالتقاط
};

const originalFetch = globalThis.fetch;

async function run() {
  // ── ١. رقم ضمن الـWABA ⇒ نجاح + حفظ ──
  {
    const { env, inserts } = createEnv();
    const calls = [];
    installFetch(
      [
        ["oauth/access_token", jsonRes({ access_token: TOKEN })],
        ["/phone_numbers", jsonRes({ data: [{ id: "111" }, { id: "222" }] })],
        ["subscribed_apps", jsonRes({ success: true })],
        ["222?fields=display_phone_number", jsonRes({ display_phone_number: "+966500000000", verified_name: "متجر" })]
      ],
      calls
    );

    const out = await connectWhatsappNumber(env, {
      merchantId: "m1",
      code: "c",
      wabaId: "900",
      phoneNumberId: "222"
    });
    assert(out.displayPhone === "+966500000000", "رقم مملوك: الربط ينجح ويرجّع بيانات العرض");
    assert(inserts.length === 1 && /wa_connections/.test(inserts[0].sql), "رقم مملوك: saveWaConnection نُفِّذت");
    assert(calls.some((u) => u.includes("/900/phone_numbers")), "رقم مملوك: سُئل غراف عن أرقام الـWABA");
  }

  // ── ٢. رقم غريب ⇒ 403 ولا حفظ ولا اشتراك ──
  {
    const { env, inserts } = createEnv();
    const calls = [];
    installFetch(
      [
        ["oauth/access_token", jsonRes({ access_token: TOKEN })],
        ["/phone_numbers", jsonRes({ data: [{ id: "111" }] })],
        ["subscribed_apps", jsonRes({ success: true })]
      ],
      calls
    );

    let err = null;
    try {
      await connectWhatsappNumber(env, { merchantId: "m2", code: "c", wabaId: "900", phoneNumberId: "999" });
    } catch (e) {
      err = e;
    }
    assert(err?.status === 403 && err?.code === "PHONE_NOT_IN_WABA", "رقم غريب: يُرفض بـ403 PHONE_NOT_IN_WABA");
    assert(/واتساب للأعمال/.test(err?.userMessage || ""), "رقم غريب: رسالة عربية للتاجر");
    assert(inserts.length === 0, "رقم غريب: لا حفظ إطلاقاً");
    assert(!calls.some((u) => u.includes("subscribed_apps")), "رقم غريب: لا اشتراك ويبهوك على WABA غير مثبتة");
  }

  // ── ٣. فشل غراف ⇒ 502 ولا حفظ ──
  {
    const { env, inserts } = createEnv();
    const calls = [];
    installFetch(
      [
        ["oauth/access_token", jsonRes({ access_token: TOKEN })],
        ["/phone_numbers", jsonRes({ error: { message: "boom" } }, false, 500)]
      ],
      calls
    );

    let err = null;
    try {
      await connectWhatsappNumber(env, { merchantId: "m3", code: "c", wabaId: "900", phoneNumberId: "222" });
    } catch (e) {
      err = e;
    }
    assert(err?.status === 502 && err?.code === "PHONE_LIST_FAILED", "فشل غراف: 502 PHONE_LIST_FAILED");
    assert(inserts.length === 0, "فشل غراف: لا حفظ");
  }

  // ── ٤. فشل جلب بيانات الرقم ⇒ 502 ولا حفظ (كان يُبلع ويُكمل) ──
  {
    const { env, inserts } = createEnv();
    const calls = [];
    installFetch(
      [
        ["oauth/access_token", jsonRes({ access_token: TOKEN })],
        ["/phone_numbers", jsonRes({ data: [{ id: "222" }] })],
        ["subscribed_apps", jsonRes({ success: true })],
        ["222?fields=display_phone_number", jsonRes({}, false, 503)]
      ],
      calls
    );

    let err = null;
    try {
      await connectWhatsappNumber(env, { merchantId: "m4", code: "c", wabaId: "900", phoneNumberId: "222" });
    } catch (e) {
      err = e;
    }
    assert(err?.status === 502 && err?.code === "PHONE_DETAILS_FAILED", "فشل بيانات الرقم: 502 بدل ابتلاع الخطأ");
    assert(inserts.length === 0, "فشل بيانات الرقم: لا حفظ");
  }

  // ── ٥. لا سطر سجل يحمل التوكن ──
  assert(logs.length > 0, "السجل سُجِّل فعلاً بحالات الفشل");
  assert(!logs.some((l) => l.includes(TOKEN)), "لا سطر سجل واحد يحتوي التوكن");
}

run()
  .catch((e) => {
    console.error = origError;
    console.error("test crashed:", e);
    process.exit(1);
  })
  .finally(() => {
    console.error = origError;
    globalThis.fetch = originalFetch;
    done();
  });
