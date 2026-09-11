// تشفير توكنات القنوات بالراحة (تقرير الأمن #5).
//
// المشكلة التي يحرسها هذا الملف: توكن واتساب للتاجر (`wa_connections.
// business_token`) وتوكن إنستغرام (`ig_connections.access_token`) كانا يُكتبان
// بـD1 **نصاً صريحاً** بينما توكنات سلة مشفَّرة بنفس المستودع — نسخة D1 مسرَّبة
// كانت تسلّم خط واتساب كل تاجر وحساب إنستغرامه دفعة واحدة.
//
// ثلاثة ادعاءات سلوكية (لا بنيوية — لا نفحص وجود استدعاء بالنص):
//   ١. الكتابة تُشفّر: القيمة الواصلة لـD1 ليست التوكن، وتبدأ بـ`enc:v1:`.
//   ٢. القراءة تفكّ: المستهلك يستلم التوكن الأصلي كما كان بالضبط.
//   ٣. صف قديم نصّي يُقرأ كما هو — التوافق الخلفي بلا هجرة (ويُشفَّر عند أول
//      إعادة كتابة).
import { createRunner, TEST_ENCRYPTION_KEY } from "../_helpers.mjs";
import { encryptSecret } from "../../functions/_lib/core/crypto.js";
import {
  saveWaConnection,
  getWaConnectionByPhoneId,
  getWaConnectionByMerchant
} from "../../functions/_lib/domain/whatsapp.js";
import {
  getIgConnectionByUserId,
  refreshExpiringIgTokens
} from "../../functions/_lib/domain/instagram.js";

const { assert, done } = createRunner("secrets-at-rest");

/** D1 وهمي: يسجّل كل كتابة، ويرجّع `row` لأي قراءة. */
function mkEnv(row = null, writes = []) {
  return {
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    writes,
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            writes.push({ sql, args });
            return {
              first: async () => row,
              all: async () => ({ results: row ? [row] : [] }),
              run: async () => ({ meta: { changes: 1 } })
            };
          }
        };
      }
    }
  };
}

async function main() {
  // ── ١. واتساب: الكتابة تُشفّر ─────────────────────────────────────────────
  {
    const writes = [];
    const env = mkEnv(null, writes);
    await saveWaConnection(env, {
      merchantId: "m_a",
      wabaId: "W1",
      phoneNumberId: "P1",
      businessToken: "EAAG_SECRET_TOKEN",
      displayPhone: "+966500000000",
      verifiedName: "متجر أ"
    });
    const w = writes.find((e) => /INSERT INTO wa_connections/.test(e.sql));
    assert(Boolean(w), "SEC-1: saveWaConnection يكتب صف wa_connections");
    assert(
      !JSON.stringify(w.args).includes("EAAG_SECRET_TOKEN"),
      "SEC-2: التوكن الخام لا يظهر بأي وسيط يصل D1 (لا نص صريح بالقاعدة)"
    );
    assert(
      String(w.args[3]).startsWith("enc:v1:"),
      "SEC-3: العمود business_token يحمل قيمة مشفَّرة ببادئة نسخة"
    );
  }

  // ── ٢. واتساب: القراءة تفكّ ───────────────────────────────────────────────
  {
    const stored = await encryptSecret({ ENCRYPTION_KEY: TEST_ENCRYPTION_KEY }, "EAAG_SECRET_TOKEN");
    const row = {
      merchant_id: "m_a",
      waba_id: "W1",
      phone_number_id: "P1",
      business_token: stored,
      display_phone: "+966500000000",
      verified_name: "متجر أ",
      status: "active"
    };
    const byPhone = await getWaConnectionByPhoneId(mkEnv(row), "P1");
    assert(
      byPhone?.business_token === "EAAG_SECRET_TOKEN",
      "SEC-4: getWaConnectionByPhoneId يسلّم التوكن مفكوكاً للمحوّل (توجيه الويبهوك يعمل)"
    );
    assert(
      byPhone?.display_phone === "+966500000000" && byPhone?.merchant_id === "m_a",
      "SEC-5: بقية أعمدة الصف تمرّ كما هي (لا تشويه بالتغليف)"
    );
    const byMerchant = await getWaConnectionByMerchant(mkEnv(row), "m_a");
    assert(
      byMerchant?.business_token === "EAAG_SECRET_TOKEN",
      "SEC-6: getWaConnectionByMerchant يفكّ التوكن كذلك (لا قارئ يفوت)"
    );
  }

  // ── ٣. واتساب: صف قديم نصّي ───────────────────────────────────────────────
  {
    const legacy = {
      merchant_id: "m_old",
      phone_number_id: "P_OLD",
      business_token: "PLAINTEXT_LEGACY",
      status: "active"
    };
    const conn = await getWaConnectionByPhoneId(mkEnv(legacy), "P_OLD");
    assert(
      conn?.business_token === "PLAINTEXT_LEGACY",
      "SEC-7: صف كُتب قبل التشفير يُقرأ كما هو — لا هجرة، ولا تاجر ينقطع خطه"
    );
  }

  // ── ٤. واتساب: غياب المفتاح = رمي، لا كتابة صريحة ─────────────────────────
  {
    const writes = [];
    const env = mkEnv(null, writes);
    delete env.ENCRYPTION_KEY;
    let threw = false;
    try {
      await saveWaConnection(env, { merchantId: "m_a", wabaId: "W1", phoneNumberId: "P1", businessToken: "T" });
    } catch {
      threw = true;
    }
    assert(threw, "SEC-8: بلا ENCRYPTION_KEY الحفظ يرمي (fail closed)");
    assert(writes.length === 0, "SEC-9: ولا يكتب التوكن صريحاً كـ«تمرير برشاقة»");
  }

  // ── ٥. إنستغرام: القراءة تفكّ، والصف القديم يمرّ ──────────────────────────
  {
    const stored = await encryptSecret({ ENCRYPTION_KEY: TEST_ENCRYPTION_KEY }, "IG_SECRET");
    const enc = await getIgConnectionByUserId(
      mkEnv({ merchant_id: "m_a", ig_user_id: "IG_A", access_token: stored, token_expires_at: 1 }),
      "IG_A"
    );
    assert(enc?.access_token === "IG_SECRET", "SEC-10: getIgConnectionByUserId يفكّ access_token");
    const legacy = await getIgConnectionByUserId(
      mkEnv({ merchant_id: "m_a", ig_user_id: "IG_A", access_token: "IG_PLAIN", token_expires_at: 1 }),
      "IG_A"
    );
    assert(legacy?.access_token === "IG_PLAIN", "SEC-11: صف إنستغرام قديم نصّي يُقرأ كما هو");
  }

  // ── ٦. إنستغرام: التجديد يفكّ القديم ويشفّر الجديد ────────────────────────
  {
    const nowS = Math.floor(Date.now() / 1000);
    const stored = await encryptSecret({ ENCRYPTION_KEY: TEST_ENCRYPTION_KEY }, "IG_OLD");
    const writes = [];
    const env = mkEnv(
      { merchant_id: "m_a", ig_user_id: "IG_A", access_token: stored, token_expires_at: nowS + 3600 },
      writes
    );
    const realFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return { ok: true, json: async () => ({ access_token: "IG_NEW", expires_in: 5184000 }) };
    };
    let out;
    try {
      out = await refreshExpiringIgTokens(env, null);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert(out.refreshed === 1 && out.failed === 0, "SEC-12: صف مشفَّر يُجدَّد بنجاح (الفكّ قبل نداء Meta)");
    assert(
      calls.length === 1 && calls[0].includes("IG_OLD") && !calls[0].includes("enc%3Av1"),
      "SEC-13: التجديد يُرسل التوكن **مفكوكاً** لميتا لا النص المشفَّر"
    );
    const w = writes.find((e) => /UPDATE ig_connections/.test(e.sql));
    assert(
      w && String(w.args[0]).startsWith("enc:v1:") && !JSON.stringify(w.args).includes("IG_NEW"),
      "SEC-14: التوكن المجدَّد يعود للقاعدة مشفَّراً (لا ارتداد لنص صريح عند التجديد)"
    );
  }

  done();
}

await main();
