import { withApi } from "../../_lib/core/respond.js";
import { saveAbandonedCart } from "../../_lib/core/db.js";
import { sendWaText, waConfigured } from "../../_lib/integrations/whatsapp.js";
import { resolveStoreId } from "../../_lib/core/session.js";
import { checkRateLimit } from "../../_lib/core/rateLimit.js";

async function cartRecoveryHandler(body, env, request) {
  const clientIp = request.headers.get("cf-connecting-ip") || "127.0.0.1";
  const rateCheck = await checkRateLimit(env, clientIp, "cart_recovery", 15, 60);
  if (!rateCheck.allowed) {
    throw new Error("تجاوزت حد الطلبات المسموح به. يرجى الانتظار دقيقة.");
  }
  const { customerName, customerPhone, items, total, cartUrl } = body;

  const merchantId = await resolveStoreId(request, env, body.storeId);
  if (!merchantId) {
    throw new Error("unauthorized");
  }

  if (!customerPhone) {
    throw new Error("رقم الجوال مطلوب لاسترجاع السلة");
  }

  const cartId = `cart_${crypto.randomUUID().slice(0, 12)}`;

  await saveAbandonedCart(env, {
    id: cartId,
    merchantId,
    customerName,
    customerPhone,
    items: items || [],
    total: total || 0
  });

  const nameToUse = customerName ? customerName.split(" ")[0] : "عميلنا العزيز";
  const linkText = cartUrl ? `\nلإكمال الطلب: ${cartUrl}` : "";
  const messageBody = `أهلاً ${nameToUse}، لاحظنا إنك نسيت المنتجات بسلتك.. كود الخصم [HALA5] ينتظرك لإكمال طلبك!${linkText}`;

  let messageSent = false;
  
  if (waConfigured(env)) {
    try {
      await sendWaText(env, {
        to: customerPhone,
        body: messageBody
      });
      messageSent = true;
    } catch (err) {
      console.warn("[cart_recovery] Failed to send WhatsApp reminder:", err);
    }
  }

  return {
    ok: true,
    cartId,
    messageSent,
    recoveredCount: 1
  };
}

export const onRequestPost = withApi(cartRecoveryHandler);
