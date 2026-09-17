// tests/unit/webhook-guard.test.mjs — SEC-2 (2026-09-17)
// سقف حجم الجسم **قبل** حساب الـHMAC، ومنع تكرار أحداث الويبهوك بعد التحقق.
import { createRunner, fakeKv } from "../_helpers.mjs";

const { assert, done } = createRunner("webhook-guard");

function req(body, headers = {}) {
  return new Request("https://x/api/webhooks/salla", { method: "POST", headers, body });
}

async function hmacHex(secret, body) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// env يرصد قراءة السر: لو قُرئ فالتوقيع حُسب. الهدف إثبات أن ٤١٣ يسبق الـHMAC.
function spyEnv(secretName, secretValue, extra = {}) {
  const hits = { secretRead: 0 };
  const env = { ...extra };
  Object.defineProperty(env, secretName, {
    get() { hits.secretRead++; return secretValue; },
    enumerable: true
  });
  return { env, hits };
}

function ctx(request, env) {
  const waited = [];
  return { context: { request, env, waitUntil: (p) => waited.push(Promise.resolve(p).catch(() => {})) }, waited };
}

async function main() {
  const { readBoundedBody, seenEvent, filterUnseen, sallaEventKey, MAX_WEBHOOK_BODY_BYTES } =
    await import("../../functions/_lib/core/webhookGuard.js");

  // ── ١) سقف الحجم ─────────────────────────────────────────────────────────
  assert(MAX_WEBHOOK_BODY_BYTES === 512 * 1024, "SEC2-1: السقف ٥١٢ كيلوبايت");

  const small = JSON.stringify({ event: "x" });
  assert((await readBoundedBody(req(small))) === small, "SEC2-2: جسم صغير يُقرأ كما هو");

  const big = "a".repeat(MAX_WEBHOOK_BODY_BYTES + 1);
  assert((await readBoundedBody(req(big))) === null, "SEC2-3: جسم فوق السقف ⇒ null (٤١٣)");
  assert(
    (await readBoundedBody(req(small, { "content-length": String(MAX_WEBHOOK_BODY_BYTES + 99) }))) === null,
    "SEC2-4: Content-Length معلن فوق السقف يُرفض قبل القراءة"
  );

  // ── ٢) ٤١٣ قبل الـHMAC — نقطة سلة ───────────────────────────────────────
  {
    const { onRequestPost } = await import("../../functions/api/webhooks/salla.js");
    const body = "x".repeat(MAX_WEBHOOK_BODY_BYTES + 10);
    const { env, hits } = spyEnv("SALLA_WEBHOOK_SECRET", "s3cr3t");
    const r = req(body, { "content-type": "application/json", "X-Salla-Signature": await hmacHex("s3cr3t", body) });
    const { context, waited } = ctx(r, env);
    const res = await onRequestPost(context);
    assert(res.status === 413, "SEC2-5: سلة — جسم ضخم ⇒ ٤١٣ حتى بتوقيع صحيح");
    assert(hits.secretRead === 0, "SEC2-6: سلة — سر الويبهوك لم يُقرأ ⇒ الـHMAC لم يُحسب أصلاً");
    assert(waited.length === 0, "SEC2-7: سلة — لا معالجة خلفية لجسم مرفوض");
  }

  // ── ٣) ٤١٣ قبل الـHMAC — نقطة واتساب ────────────────────────────────────
  {
    const { onRequestPost } = await import("../../functions/api/whatsapp/webhook.js");
    const body = "x".repeat(MAX_WEBHOOK_BODY_BYTES + 10);
    const { env, hits } = spyEnv("WHATSAPP_APP_SECRET", "appsecret", { HALA_CACHE: fakeKv() });
    const r = new Request("https://x/api/whatsapp/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Hub-Signature-256": `sha256=${await hmacHex("appsecret", body)}` },
      body
    });
    const { context, waited } = ctx(r, env);
    const res = await onRequestPost(context);
    assert(res.status === 413, "SEC2-8: واتساب — جسم ضخم ⇒ ٤١٣ حتى بتوقيع صحيح");
    assert(hits.secretRead === 0, "SEC2-9: واتساب — سر التطبيق لم يُقرأ ⇒ لا حساب HMAC");
    assert(waited.length === 0, "SEC2-10: واتساب — لا معالجة خلفية لجسم مرفوض");
  }

  // ── ٤) منع التكرار العام ────────────────────────────────────────────────
  {
    const kv = fakeKv();
    const env = { HALA_CACHE: kv };
    assert((await seenEvent(env, "k1")) === false, "SEC2-11: أول ظهور للمفتاح ⇒ يُعالَج");
    assert((await seenEvent(env, "k1")) === true, "SEC2-12: نفس المفتاح ثانيةً ⇒ مكرَّر");
    assert((await seenEvent(env, "k2")) === false, "SEC2-13: مفتاح آخر لا يتأثر");

    let ttl = null;
    const ttlKv = { get: async () => null, put: async (_k, _v, opts) => { ttl = opts?.expirationTtl; } };
    await seenEvent({ HALA_CACHE: ttlKv }, "k3");
    assert(ttl === 86400, "SEC2-14: عمر المفتاح ٢٤ ساعة");
  }

  // ── ٥) رسالة واتساب مكرَّرة تُعالَج مرة واحدة بلا إسقاط الدفعة ──────────
  {
    const env = { HALA_CACHE: fakeKv() };
    const key = (m) => (m?.id ? `wa:${m.id}` : null);
    const first = await filterUnseen(env, [{ id: "wamid.A" }, { id: "wamid.B" }], key);
    assert(first.length === 2, "SEC2-15: أول دفعة تمر كاملة");
    const second = await filterUnseen(env, [{ id: "wamid.A" }, { id: "wamid.C" }], key);
    assert(
      second.length === 1 && second[0].id === "wamid.C",
      "SEC2-16: إعادة الإرسال تُسقط المكرَّر فقط — الرسالة الجديدة بنفس الدفعة تمر"
    );
    const noId = await filterUnseen(env, [{ text: "بلا معرّف" }], key);
    assert(noId.length === 1, "SEC2-17: عنصر بلا معرّف يمر (لا ندّعي أنه مكرَّر)");
  }

  // ── ٦) حدث سلة مكرَّر ⇒ ٢٠٠ بلا أي أثر جانبي ────────────────────────────
  {
    const { onRequestPost } = await import("../../functions/api/webhooks/salla.js");
    const secret = "salla-secret";
    const body = JSON.stringify({ event: "order.created", merchant: 5551, created_at: "2026-09-17 10:00:00", data: { scope: "" } });
    const sig = await hmacHex(secret, body);
    const kv = fakeKv();
    const env = {
      SALLA_WEBHOOK_SECRET: secret,
      HALA_CACHE: kv,
      DB: { prepare: () => ({ bind: () => ({ run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) }) }) }
    };
    const post = async () => {
      const { context, waited } = ctx(req(body, { "content-type": "application/json", "X-Salla-Signature": sig }), env);
      const res = await onRequestPost(context);
      await Promise.all(waited);
      return { res, waited };
    };
    const a = await post();
    assert(a.res.status === 200 && a.waited.length > 0, "SEC2-18: أول وصول للحدث يُعالَج");
    const b = await post();
    assert(b.res.status === 200, "SEC2-19: إعادة الإرسال تُقرّ بـ٢٠٠ (سلة لا تعيد المحاولة)");
    assert(b.waited.length === 0, "SEC2-20: الحدث المكرَّر بلا أي أثر جانبي — لا معالجة ولا سجل");

    const key = await sallaEventKey(JSON.parse(body), body);
    assert(key === "salla:order.created:5551:2026-09-17 10:00:00", "SEC2-21: مفتاح سلة = الحدث+التاجر+الختم");
    const hashed = await sallaEventKey({ event: "order.created" }, body);
    assert(/^salla:order\.created:[0-9a-f]{32}$/.test(hashed), "SEC2-22: بلا تاجر/ختم ⇒ بصمة الجسم الخام");
  }

  // ── ٧) غياب KV لا يوقف الويبهوك، ويُسجَّل ───────────────────────────────
  {
    const lines = [];
    const orig = console.error;
    console.error = (...a) => lines.push(a.join(" "));
    try {
      assert((await seenEvent({}, "kx")) === false, "SEC2-23: بلا ربط KV ⇒ المعالجة تستمر (fail-open)");
      assert((await seenEvent({}, "ky")) === false, "SEC2-24: وتستمر للحدث التالي أيضاً");
      const items = await filterUnseen({}, [{ id: "1" }, { id: "1" }], (m) => `wa:${m.id}`);
      assert(items.length === 2, "SEC2-25: بلا KV لا يُحجب شيء — التكرار أهون من تعطّل الويبهوك");
    } finally {
      console.error = orig;
    }
    const missing = lines.filter((l) => l.includes("WEBHOOK_DEDUPE_KV_MISSING"));
    assert(missing.length === 1, "SEC2-26: غياب KV يُسجَّل مرة واحدة لا مع كل حدث");
  }

  done();
}

main().catch((e) => {
  console.error("❌ webhook-guard tests threw:", e);
  process.exit(1);
});
