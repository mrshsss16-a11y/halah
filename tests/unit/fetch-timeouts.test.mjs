// 2026-09-17: يتحقق أن كل نداء خارجي بالمحوّلات المملوكة لحزمة WP-A7 (SCALE-2)
// يمرّر AbortSignal.timeout ويترجم انتهاء المهلة لخطأ من نفس صنف الأخطاء التي
// يتوقعها المستدعي أصلاً (لا 500 خام). لا readFileSync — كل الفحص عبر استيراد
// الوحدات نفسها ومحاكاة fetch.
import { createRunner } from "../_helpers.mjs";
import * as email from "../../functions/_lib/integrations/email.js";
import * as whatsapp from "../../functions/_lib/integrations/whatsapp.js";
import * as instagram from "../../functions/_lib/integrations/instagram.js";
import * as salla from "../../functions/_lib/integrations/salla.js";
import { askNexos } from "../../functions/_lib/ai/nexos.js";
import { askVisionDetailed } from "../../functions/_lib/ai/vision.js";

const { assert, done } = createRunner("fetch-timeouts");

async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

function timeoutRejection() {
  return async () => {
    const err = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    throw err;
  };
}

async function expectThrows(fn, label) {
  try {
    await fn();
    return { threw: false };
  } catch (err) {
    return { threw: true, message: String(err?.message || err) };
  }
}

async function main() {
  // ── email.js ──────────────────────────────────────────────────────────
  {
    let capturedSignal = null;
    const env = { RESEND_API_KEY: "k", EMAIL_FROM: "هالة <a@aura.sa>" };
    await withFetch(async (_url, init) => {
      capturedSignal = init?.signal;
      return new Response(JSON.stringify({ id: "1" }), { status: 200 });
    }, () => email.send(env, { to: "x@x.com", subject: "s", text: "t" }));
    assert(capturedSignal instanceof AbortSignal, "email.send يمرّر AbortSignal بالنداء");

    const { threw, message } = await expectThrows(() =>
      withFetch(timeoutRejection(), () => email.send(env, { to: "x@x.com", subject: "s", text: "t" }))
    );
    assert(threw && /timeout/i.test(message), `email.send يرمي خطأ مهلة واضحاً عند TimeoutError (${message})`);
  }

  // ── whatsapp.js ───────────────────────────────────────────────────────
  {
    const env = { WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_ID: "p" };
    let sig = null;
    await withFetch(async (_url, init) => {
      sig = init?.signal;
      return new Response(JSON.stringify({ messages: [{ id: "1" }] }), { status: 200 });
    }, () => whatsapp.sendWaText(env, { to: "1", body: "hi" }));
    assert(sig instanceof AbortSignal, "sendWaText يمرّر AbortSignal");

    let r2 = await expectThrows(() => withFetch(timeoutRejection(), () => whatsapp.sendWaText(env, { to: "1", body: "hi" })));
    assert(r2.threw && /timeout/i.test(r2.message), `sendWaText يرمي خطأ مهلة واضحاً (${r2.message})`);

    let sig2 = null;
    await withFetch(async (_url, init) => {
      sig2 = init?.signal;
      return new Response(JSON.stringify({ messages: [{ id: "1" }] }), { status: 200 });
    }, () => whatsapp.sendWaTemplate(env, { to: "1", template: "t" }));
    assert(sig2 instanceof AbortSignal, "sendWaTemplate يمرّر AbortSignal");

    let sig3 = null;
    await withFetch(async (_url, init) => {
      sig3 = init?.signal;
      return new Response(JSON.stringify({ messages: [{ id: "1" }] }), { status: 200 });
    }, () => whatsapp.sendWaInteractiveList(env, { to: "1", bodyText: "b", buttonText: "b", rows: [] }));
    assert(sig3 instanceof AbortSignal, "sendWaInteractiveList يمرّر AbortSignal");

    let sigs = [];
    await withFetch(async (url, init) => {
      sigs.push(init?.signal);
      if (String(url).includes("smb_app_data")) return new Response("{}", { status: 200 });
      return new Response(JSON.stringify({ url: "https://graph.facebook.com/media/1" }), { status: 200 });
    }, () => whatsapp.getWaMedia(env, "media1"));
    assert(sigs.every((s) => s instanceof AbortSignal), "getWaMedia يمرّر AbortSignal لكل نداء (meta + download)");

    let sig5 = null;
    await withFetch(async (_url, init) => {
      sig5 = init?.signal;
      return new Response("{}", { status: 200 });
    }, () => whatsapp.requestCoexistenceSync("waba1", "tok", "history"));
    assert(sig5 instanceof AbortSignal, "requestCoexistenceSync يمرّر AbortSignal");

    let r3 = await expectThrows(() => withFetch(timeoutRejection(), () => whatsapp.requestCoexistenceSync("waba1", "tok", "history")));
    assert(r3.threw && /timeout/i.test(r3.message), `requestCoexistenceSync يرمي خطأ مهلة واضحاً (${r3.message})`);
  }

  // ── instagram.js ──────────────────────────────────────────────────────
  {
    const conn = { ig_user_id: "ig1", access_token: "tok" };
    const env = {};
    let sig = null;
    await withFetch(async (_url, init) => {
      sig = init?.signal;
      return new Response(JSON.stringify({ id: "1" }), { status: 200 });
    }, () => instagram.send(env, { conn, mode: "dm", recipientId: "u1" }, { text: "hi" }));
    assert(sig instanceof AbortSignal, "instagram.send (igPost) يمرّر AbortSignal");

    let r = await expectThrows(() =>
      withFetch(timeoutRejection(), () => instagram.send(env, { conn, mode: "dm", recipientId: "u1" }, { text: "hi" }))
    );
    assert(r.threw && /timeout/i.test(r.message), `instagram.send يرمي خطأ مهلة واضحاً عند TimeoutError (${r.message})`);

    let sig2 = null;
    await withFetch(async (_url, init) => {
      sig2 = init?.signal;
      return new Response(JSON.stringify({ access_token: "new", expires_in: 100 }), { status: 200 });
    }, () => instagram.refreshLongLivedToken("old-token"));
    assert(sig2 instanceof AbortSignal, "refreshLongLivedToken يمرّر AbortSignal");

    let r4 = await expectThrows(() => withFetch(timeoutRejection(), () => instagram.refreshLongLivedToken("old-token")));
    assert(r4.threw && /timeout/i.test(r4.message), `refreshLongLivedToken يرمي خطأ مهلة واضحاً (${r4.message})`);
  }

  // ── salla.js ──────────────────────────────────────────────────────────
  {
    let sig = null;
    await withFetch(async (_url, init) => {
      sig = init?.signal;
      return new Response(JSON.stringify({ access_token: "a", refresh_token: "b" }), { status: 200 });
    }, () => salla.refreshSallaToken({ refreshToken: "r", clientId: "c", clientSecret: "s" }));
    assert(sig instanceof AbortSignal, "refreshSallaToken يمرّر AbortSignal");

    let r = await expectThrows(() =>
      withFetch(timeoutRejection(), () => salla.refreshSallaToken({ refreshToken: "r", clientId: "c", clientSecret: "s" }))
    );
    assert(r.threw && /timeout/i.test(r.message), `refreshSallaToken يرمي خطأ مهلة واضحاً (${r.message})`);

    let sig2 = null;
    await withFetch(async (_url, init) => {
      sig2 = init?.signal;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }, () => salla.listProducts("tok"));
    assert(sig2 instanceof AbortSignal, "listProducts (sallaFetch) يمرّر AbortSignal");

    let r2 = await expectThrows(() => withFetch(timeoutRejection(), () => salla.listProducts("tok")));
    assert(r2.threw && /timeout/i.test(r2.message) && r2.message.includes("salla"), `listProducts يرمي خطأ سلة مصنَّف عند مهلة (${r2.message})`);
  }

  // ── nexos.js ──────────────────────────────────────────────────────────
  {
    let sig = null;
    const text = await withFetch(async (_url, init) => {
      sig = init?.signal;
      return new Response(JSON.stringify({ choices: [{ message: { content: "وصف" } }] }), { status: 200 });
    }, () => askNexos({ apiKey: "k", messages: [{ role: "user", content: "u" }], maxTokens: 50 }));
    assert(sig instanceof AbortSignal && text === "وصف", "askNexos يمرّر AbortSignal");

    const r = await expectThrows(() =>
      withFetch(timeoutRejection(), () => askNexos({ apiKey: "k", messages: [{ role: "user", content: "u" }], maxTokens: 50 }))
    );
    assert(r.threw && /timeout/i.test(r.message), `askNexos يرمي خطأ مهلة عند فشل كل النماذج بمهلة (${r.message})`);
  }

  // ── vision.js (المزوّدون الخارجيون فقط — env.AI.run ليس fetch) ──────────
  {
    const dataUrlEnv = { GROQ_API_KEY: "g" };
    let sig = null;
    const { text, model } = await withFetch(async (_url, init) => {
      sig = init?.signal;
      return new Response(JSON.stringify({ choices: [{ message: { content: "وصف رؤية" } }] }), { status: 200 });
    }, () => askVisionDetailed({ env: dataUrlEnv, imageBuffer: new Uint8Array([1, 2, 3]).buffer, prompt: "صف" }));
    assert(sig instanceof AbortSignal && text === "وصف رؤية" && model?.startsWith("groq:"), "askVisionDetailed (Groq) يمرّر AbortSignal");

    const r = await expectThrows(() =>
      withFetch(timeoutRejection(), () => askVisionDetailed({ env: dataUrlEnv, imageBuffer: new Uint8Array([1, 2, 3]).buffer, prompt: "صف" }))
    );
    // askVisionDetailed لا يرمي أبداً (يجمع الأخطاء ويعيد نصاً فارغاً) — التحقق أن الفشل انعكس بسلسلة الأخطاء لا استثناء غير مصنَّف يهرب من العقد.
    assert(!r.threw, "askVisionDetailed يحافظ على عقده (لا يرمي) حتى عند مهلة كل الطبقات");
  }

  done();
}

main();
