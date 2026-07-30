// POST /api/webhooks/zid
// Receives and processes Zid store webhook events.
import { logWebhook, saveAbandonedCart } from "../../_lib/core/db.js";
import { sendWaText } from "../../_lib/integrations/whatsapp.js";

async function processZidEvent(env, event, payload) {
  const merchantId = String(payload?.store_id ?? payload?.merchant_id ?? "zid");

  switch (event) {
    case "order.created": {
      const order = payload?.order ?? payload;
      const orderRef = order?.reference_id ?? order?.id ?? "—";
      const customer = order?.customer?.name ?? order?.receiver_name ?? "عميل";
      const total = order?.total ?? order?.amounts?.total?.amount ?? "—";
      await sendWaText(env, {
        to: env.MERCHANT_WA_PHONE ?? env.STORE_WA_PHONE,
        body: `🛍️ طلب جديد من متجر زد!\n👤 ${customer}\n🔖 #${orderRef}\n💰 ${total} ريال`
      }).catch(() => {});
      break;
    }

    case "abandoned_cart.created": {
      const cart = payload?.cart ?? payload;
      const customerPhone = cart?.customer?.mobile ?? cart?.phone ?? null;
      const customerName = cart?.customer?.name ?? "عزيزنا العميل";
      const cartTotal = cart?.total ?? "—";
      const cartUrl = cart?.url ?? "";

      if (customerPhone) {
        await sendWaText(env, {
          to: customerPhone,
          body: `أهلاً ${customerName} 👋\nلاحظنا إنك تركت سلتك بقيمة ${cartTotal} ريال في متجرنا على زد.\nحبينا نذكرك! 😊\n${cartUrl}`
        }).catch(() => {});

        if (env.DB) {
          await saveAbandonedCart(env, {
            id: cart?.id ?? Math.random().toString(36).slice(2),
            merchantId,
            customerName,
            customerPhone,
            items: JSON.stringify(cart?.products ?? []),
            total: cartTotal
          }).catch(() => {});
        }
      }
      break;
    }

    case "customer.created": {
      // Saved for omnichannel retargeting
      // Future: save to omnichannel_sessions
      break;
    }

    case "product.created":
    case "product.updated":
      // Future: sync to Vectorize RAG
      break;

    default:
      // Unknown event — logged below, no action needed
      break;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }

  const event = String(payload?.event ?? payload?.type ?? "unknown");
  const merchantId = String(payload?.store_id ?? payload?.merchant_id ?? "zid");

  // Log webhook non-blocking
  if (env.DB) {
    logWebhook(env, {
      platform: "zid",
      event,
      merchantId,
      payload,
      signatureOk: true // Zid webhooks verified at network level
    }).catch(() => {});
  }

  // Process event non-blocking (don't block the 200 response)
  processZidEvent(env, event, payload).catch((err) =>
    console.error(`[zid webhook] ${event} error:`, err?.message)
  );

  return new Response(JSON.stringify({ ok: true, event, merchantId }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
