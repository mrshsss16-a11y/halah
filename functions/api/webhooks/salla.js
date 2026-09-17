// POST /api/webhooks/salla — مستقبِل ويبهوك سلة (Easy Mode).
//
// الأمن: HMAC-SHA256 على الجسم **الخام**، مقارنة ثابتة الزمن مع
// `X-Salla-Signature`. توقيع غير صالح ⇒ ٤٠١ ويُسجَّل دائماً. سلة تنتظر ٣٠ث
// وتعيد ٣ مرات، فنقرّ بسرعة وننفّذ الثقيل بـ`waitUntil`.
// المرحلة ٤: تنسيق فقط — التوقيع والأحداث بـ`domain/salla.js`، وبوابة CSRF
// مُلغاة عمداً (`csrf: false`): حارس هذه النقطة هو التوقيع لا الأصل.
import { withApi, json } from "../../_lib/core/respond.js";
import { verifySallaSignature, processVerifiedSallaEvent } from "../../_lib/domain/salla.js";
import { logWebhook } from "../../_lib/domain/platforms.js";
import { kickoffFirstSync } from "../../_lib/domain/catalogSync.js";
import { logError } from "../../_lib/core/errorLog.js";
import { readBoundedBody, seenEvent, sallaEventKey } from "../../_lib/core/webhookGuard.js";

const log = (context, code, storeId, internal) =>
  logError(context, { requestId: null, path: "webhooks/salla", code, storeId, internal });

// GET: سلة تحوّل **متصفح التاجر** هنا بعد موافقته (نفس الـURL لأن حقلي
// Callback وWebhook مضبوطان على القيمة نفسها). بـEasy Mode سلة نفسها تبادل
// الرمز وتسلّم النتيجة عبر ويبهوك app.store.authorize — المبادلة يدوياً هنا
// كانت ترجع 401 دائماً (2026-08-08، أُلغيت). نجيب على الـGET حتى لا يصير 405.
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  if (url.searchParams.has("code")) {
    context.waitUntil(
      logWebhook(env, {
        platform: "salla",
        event: "browser_redirect_seen",
        merchantId: null,
        payload: { scope: url.searchParams.get("scope"), hasState: url.searchParams.has("state") },
        signatureOk: true
      }).catch(() => {})
    );
  }
  return Response.redirect("https://s.salla.sa/apps", 302);
}

async function sallaWebhookHandler(request, env, requestId, context) {
  // 2026-09-17: سقف الحجم **قبل** حساب الـHMAC — SEC-2 (core/webhookGuard.js).
  const rawBody = await readBoundedBody(request);
  if (rawBody === null) return json({ error: "payload too large" }, 413);
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const event = payload.event || "unknown";
  const signatureOk = await verifySallaSignature(rawBody, request.headers.get("X-Salla-Signature"), env.SALLA_WEBHOOK_SECRET);

  if (!signatureOk) {
    // Q2 — توقيع مرفوض كان يمر بلا أثر: سر خاطئ بعد تدوير ومحاولة تزوير
    // يبدوان متطابقين. الجسم لا يُسجَّل (قد يحمل بيانات عميل) — الحدث فقط.
    log(context, "WEBHOOK_SIGNATURE_REJECTED", null, `event=${String(event).slice(0, 60)}`);
    context.waitUntil(logWebhook(env, { platform: "salla", event, merchantId: null, payload: { rejected: true }, signatureOk: false }).catch(() => {}));
    return json({ error: "invalid signature" }, 401);
  }

  // 2026-09-17: سلة تعيد الإرسال ٣ مرات عند أي تأخر — إعادة التنفيذ تعني تثبيتاً
  // أو مزامنة مكرَّرة. التكرار يُقرّ بـ200 بلا أي أثر جانبي — SEC-2.
  if (await seenEvent(env, await sallaEventKey(payload, rawBody))) return json({ ok: true });

  // نقرّ بسرعة؛ التصريف والتسجيل بالخلفية بـdomain (مهلة سلة ٣٠ ثانية).
  context.waitUntil(processVerifiedSallaEvent(env, {
    event,
    payload,
    onFirstSync: (id) => kickoffFirstSync(env, id, (c, s, i) => log(context, c, s, i)),
    onLog: (code, storeId, internal) => log(context, code, storeId, internal)
  }));

  return json({ ok: true });
}

export const onRequestPost = withApi.raw(sallaWebhookHandler, { csrf: false, logPath: "webhooks/salla" });
