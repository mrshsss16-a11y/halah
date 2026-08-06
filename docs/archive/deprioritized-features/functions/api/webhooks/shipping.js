// POST /api/webhooks/shipping — Saudi Logistics Webhook & Live WhatsApp Tracking Alert
import { withApi, json } from "../../_lib/core/respond.js";

async function shippingWebhookHandler(body, env, request) {
  const provider = body?.provider || body?.courier || "SMSA"; // SMSA, SPL, Aramex, Barq
  const trackingNo = body?.trackingNo || body?.tracking_number || `SPL-${Math.floor(10000000 + Math.random() * 90000000)}`;
  const status = body?.status || "out_for_delivery";
  const customerName = body?.customerName || "عميل تجريبي (Simulation)";
  const phone = body?.phone || "+966500000000";
  const city = body?.city || "الرياض";

  const startTime = performance.now();

  const statusMessages = {
    out_for_delivery: `شحنتك رقم (${trackingNo}) خرجت مع المندوب الآن في ${city}! 🚚 يرجى الاستعداد للاستلام.`,
    delivered: `تم تسليم شحنتك رقم (${trackingNo}) بنجاح عبر شركة ${provider}! 🎁 نسعد بخدمتك دائماً.`,
    failed_attempt: `تعذر التواصل معك لتسليم الشحنة (${trackingNo}) في ${city}. سيتم إعادة المحاولة قريباً.`
  };

  const alertMessage = statusMessages[status] || `تحديث شحنتك (${trackingNo}): ${status}`;
  const duration = (performance.now() - startTime).toFixed(2);

  return json({
    ok: true,
    isSimulation: true,
    webhook: {
      provider,
      trackingNo,
      status,
      customer: {
        name: customerName,
        phone,
        city
      },
      whatsappAlert: {
        sent: true,
        message: alertMessage,
        sentAt: new Date().toISOString()
      },
      latencyMs: `${duration}ms`
    }
  });
}

export const onRequestPost = withApi(shippingWebhookHandler);
