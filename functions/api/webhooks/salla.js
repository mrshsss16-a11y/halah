// POST /api/webhooks/salla — Salla Easy Mode webhook receiver.
//
// Security: HMAC-SHA256 over the RAW request body with SALLA_WEBHOOK_SECRET,
// compared timing-safe against X-Salla-Signature. Invalid signature → 401,
// always logged. Salla waits max 30s and retries 3x every ~5min, so we ack
// fast and do heavy work via context.waitUntil.
//
// Handled events:
//   app.store.authorize → upsert merchant + save access/refresh tokens (this
//                         IS the OAuth flow in Easy Mode — no callback dance)
//   app.installed       → upsert merchant
//   app.uninstalled     → حذف توكنات سلة + إلغاء مهام الجملة (فك ربط فوري)
//   abandoned.cart      → store cart for the WhatsApp recovery feature
//   order.created       → log (dashboard feed reads webhook_log for now)
import {
  upsertMerchantFromSalla,
  saveTokens,
  logWebhook,
  saveAbandonedCart,
  revokeSallaConnection,
  getActiveJobByKind
} from "../../_lib/core/db.js";
import { logError } from "../../_lib/core/errorLog.js";
import { syncFirstPage } from "../store/catalog/sync.js";
import { getStoreInfo } from "../../_lib/integrations/salla.js";

/**
 * أول سحب للمنتجات **فور الربط** — بلا انتظار ضغطة زر.
 *
 * مرصود 2026-09-09: التاجر ربط متجراً جديداً، فتح «منتجاتي» فوجدها فارغة
 * وحكم أن التطبيق "خرب". السبب أن السحب كان يبدأ فقط بضغطة «اسحب منتجاتي»،
 * وتاجر جديد لا يعرف أن عليه ضغطها. أول انطباع = شاشة فارغة = تطبيق معطّل.
 *
 * صفحة واحدة فقط (نفس قاعدة sync.js: حد سلة ١ طلب/ثانية لكل متجر)، والباقي
 * للوظيفة. الفشل هنا لا يُفشل الويبهوك: التوكن محفوظ، والزر باقٍ كمسار بديل.
 * يُتجاهل إن كان سحب شغّالاً أصلاً (إعادة تصريح على متجر قائم).
 */
async function kickoffFirstSync(env, merchantId, context) {
  try {
    const active = await getActiveJobByKind(env, merchantId, "catalog_sync");
    if (active) return;
    await syncFirstPage(env, merchantId);
  } catch (err) {
    logError(context, {
      requestId: null,
      path: "webhooks/salla",
      code: "SALLA_FIRST_SYNC_FAILED",
      storeId: merchantId,
      internal: String(err?.message || err).slice(0, 300)
    });
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}

async function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const computed = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // timing-safe compare
  if (computed.length !== signatureHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  }
  return diff === 0;
}

async function handleEvent(env, event, payload, context) {
  const data = payload.data || {};
  const sallaMerchantId = payload.merchant || data.merchant || null;

  switch (event) {
    case "app.store.authorize": {
      // data: { access_token, refresh_token, expires (unix), scope }
      const merchantId = await upsertMerchantFromSalla(env, {
        sallaMerchantId,
        storeName: data.store_name || null
      });
      await saveTokens(env, {
        merchantId,
        platform: "salla",
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Number(data.expires) || Math.floor(Date.now() / 1000) + 14 * 24 * 3600
      });
      // إعادة تثبيت بعد فك ربط ⇒ الختم يُصفَّر، وإلا عرض الداشبورد "مفكوك" لمتجر مربوط.
      await env.DB.prepare("UPDATE merchants SET salla_disconnected_at = NULL WHERE id = ?")
        .bind(merchantId)
        .run()
        .catch(() => {});
      // اسم المتجر: الحمولة لا تحمله، والتوكن صار بيدنا الآن. /store/info يحتاج
      // scope `settings.read` — نتحقق من scope الحمولة قبل استهلاك طلب على سلة
      // (حد ١ط/ث) بدل 403 يلوّث سجل الأخطاء بكل تثبيت. فشله لا يوقف شيئاً.
      const grantedScope = String(data.scope || "");
      if (/\bsettings\.read(_write)?\b/.test(grantedScope) || grantedScope === "") {
        try {
          const info = await getStoreInfo(env, merchantId);
          if (info.name) await upsertMerchantFromSalla(env, { sallaMerchantId, storeName: info.name });
        } catch (err) {
          logError(context, { requestId: null, path: "webhooks/salla", code: "SALLA_STORE_INFO_FAILED", storeId: merchantId, internal: String(err?.message || err).slice(0, 300) });
        }
      }
      // أول سحب فوراً — التاجر يفتح «منتجاتي» فيجد منتجاته لا شاشة فارغة.
      await kickoffFirstSync(env, merchantId, context);
      return merchantId;
    }
    case "app.installed": {
      return upsertMerchantFromSalla(env, {
        sallaMerchantId,
        storeName: (data.store && data.store.name) || data.store_name || null
      });
    }
    // كان هذا الحدث **مفقوداً**: التاجر يحذف التطبيق ويبقى توكن وصوله محفوظاً
    // عندنا للأبد. سلة ترسل `app.uninstalled` عند الحذف، وقد ترسل
    // `app.subscription.expired`/`app.trial.expired` عند انتهاء الاشتراك —
    // الثلاثة تعني نفس الشيء أمنياً: لم يعد لنا إذن على هذا المتجر.
    case "app.uninstalled":
    case "app.subscription.expired":
    case "app.trial.expired": {
      if (!sallaMerchantId) return null;
      const merchantId = await upsertMerchantFromSalla(env, { sallaMerchantId });
      await revokeSallaConnection(env, merchantId);
      return merchantId;
    }
    case "abandoned.cart": {
      if (!sallaMerchantId) return null;
      const merchantId = await upsertMerchantFromSalla(env, { sallaMerchantId });
      const customer = data.customer || {};
      await saveAbandonedCart(env, {
        id: `salla_${data.id || crypto.randomUUID()}`,
        merchantId,
        customerName: [customer.first_name, customer.last_name].filter(Boolean).join(" ") || null,
        customerPhone: customer.mobile || null,
        items: (data.items || []).map((i) => ({ name: i.name, qty: i.quantity, price: i.price && i.price.amount })),
        total: (data.total && data.total.amount) || 0
      });
      return merchantId;
    }
    default:
      // order.created, product.* etc. — logged below; consumers read webhook_log
      return sallaMerchantId ? upsertMerchantFromSalla(env, { sallaMerchantId }) : null;
  }
}

// GET /api/webhooks/salla?code=...&scope=...&state=...
//
// Salla redirects the MERCHANT'S BROWSER here right after they approve app
// scopes — separate from the real webhook delivery (POST, server-to-server).
// This is the same URL as the webhook receiver because the Callback URL and
// Webhook URL fields happened to be set to the same value in the Partner
// Portal.
//
// Per Salla's own Easy Mode documentation: "Salla will handle everything,
// including extracting the authorization code... to generate an access
// token" — the code in this URL is NOT meant for us to exchange ourselves;
// Salla exchanges it on their side and delivers the result via the
// app.store.authorize webhook (POST, handled below). An earlier version of
// this handler tried a manual code exchange here (Custom-Mode-style) as a
// workaround, which consistently 401'd — consistent with Salla having
// already consumed the code before we could. Reverted (2026-08-08): this
// handler now only answers the GET so it doesn't 405, and logs that the
// redirect happened, for diagnosing why the real webhook isn't following it.
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const hasCode = url.searchParams.has("code");

  if (hasCode) {
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

export async function onRequestPost(context) {
  const { request, env } = context;
  const rawBody = await request.text();

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const signatureOk = await verifySignature(
    rawBody,
    request.headers.get("X-Salla-Signature"),
    env.SALLA_WEBHOOK_SECRET
  );
  const event = payload.event || "unknown";

  if (!signatureOk) {
    context.waitUntil(
      logWebhook(env, { platform: "salla", event, merchantId: null, payload: { rejected: true }, signatureOk: false }).catch(() => {})
    );
    return json({ error: "invalid signature" }, 401);
  }

  // Ack fast; process + log in the background (Salla 30s deadline).
  context.waitUntil(
    (async () => {
      let merchantId = null;
      let handlerError = null;
      try {
        merchantId = await handleEvent(env, event, payload, context);
      } catch (err) {
        logError(context, { requestId: null, path: "webhooks/salla", code: "SALLA_EVENT_FAILED", internal: `${event}: ${err?.message || err}`, storeId: merchantId });
        // Temporary diagnostic (2026-08-08): app.store.authorize was silently
        // failing to persist tokens with zero trace of why. Capture the error
        // message (never the tokens themselves) so it's visible without a live
        // tail session. Remove once the root cause is confirmed fixed.
        handlerError = String((err && err.message) || err).slice(0, 300);
      }
      // Never persist tokens in the log — redact before writing.
      const safePayload =
        event === "app.store.authorize"
          ? { event, merchant: payload.merchant, data: { scope: payload.data && payload.data.scope, redacted: true }, handlerError }
          : { ...payload, handlerError };
      await logWebhook(env, { platform: "salla", event, merchantId, payload: safePayload, signatureOk: true }).catch(() => {});
    })()
  );

  return json({ ok: true });
}
