// POST /api/whatsapp/send
// body: { to, body, template?, lang?, components? }
// Manual/merchant-triggered outbound WhatsApp message (e.g. abandoned-cart
// recovery). Free-form text only works inside the 24h window; outside it, pass
// a pre-approved template name instead.
import { withApi, ApiError } from "../../_lib/respond.js";
import { sendWaText, sendWaTemplate, waConfigured } from "../../_lib/whatsapp.js";
import { isWaWindowOpen, recordWaOutbound } from "../../_lib/db.js";
import { requireAdmin } from "../../_lib/session.js";

async function sendHandler(body, env, request) {
  // Outbound messages go out from the platform's own WhatsApp number
  // (WHATSAPP_MERCHANT_ID), so this must never be callable anonymously —
  // otherwise anyone can spam arbitrary phones as "hala". Admin only.
  const admin = await requireAdmin(request, env);
  if (!admin) {
    throw new ApiError(403, "هذه العملية تتطلب صلاحية مشرف.", "ADMIN_REQUIRED");
  }
  if (!waConfigured(env)) {
    return { ok: false, error: "WhatsApp غير مفعّل — أضف WHATSAPP_TOKEN و WHATSAPP_PHONE_ID بأسرار Cloudflare." };
  }
  const to = (body.to || "").toString().replace(/[^\d]/g, "");
  if (!to) return { ok: false, error: "رقم المستقبل مفقود." };
  const merchantId = env.WHATSAPP_MERCHANT_ID || "hala";

  // Outside the 24h window a template is required by WhatsApp policy.
  if (body.template) {
    const id = await sendWaTemplate(env, {
      to,
      template: body.template,
      lang: body.lang || "ar",
      components: body.components || []
    });
    await recordWaOutbound(env, { merchantId, phone: to, body: `[template:${body.template}]`, waMessageId: id });
    return { ok: true, messageId: id, kind: "template" };
  }

  const text = (body.body || "").toString();
  if (!text) return { ok: false, error: "نص الرسالة مفقود." };

  const windowOpen = await isWaWindowOpen(env, merchantId, to).catch(() => false);
  if (!windowOpen) {
    return {
      ok: false,
      error: "خارج نافذة الـ24 ساعة — لا يمكن إرسال رسالة حرة. استخدم قالباً معتمداً (template).",
      code: "WINDOW_CLOSED"
    };
  }

  const id = await sendWaText(env, { to, body: text });
  await recordWaOutbound(env, { merchantId, phone: to, body: text, waMessageId: id });
  return { ok: true, messageId: id, kind: "text" };
}

export const onRequestPost = withApi(sendHandler);
