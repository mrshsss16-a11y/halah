// POST /api/whatsapp/send
// body: { to, body, template?, lang?, components? }
// Manual/merchant-triggered outbound WhatsApp message (e.g. abandoned-cart
// recovery). Free-form text only works inside the 24h window; outside it, pass
// a pre-approved template name instead.
import { withApi, ApiError } from "../../_lib/core/respond.js";
import { sendOutboundMessage } from "../../_lib/domain/whatsapp.js";
import { requireAdmin } from "../../_lib/core/session.js";

async function sendHandler(body, env, request) {
  // Outbound messages go out from the platform's own WhatsApp number
  // (WHATSAPP_MERCHANT_ID), so this must never be callable anonymously —
  // otherwise anyone can spam arbitrary phones as "hala". Admin only.
  const admin = await requireAdmin(request, env);
  if (!admin) {
    throw new ApiError(403, "هذه العملية تتطلب صلاحية مشرف.", "ADMIN_REQUIRED");
  }
  // ق٦: الإرسال نفسه (القناة، القالب، نافذة الـ٢٤ ساعة، تسجيل الصادر)
  // بـ`domain/whatsapp.js`؛ هنا تبقى الصلاحية وشكل الرد فقط.
  return sendOutboundMessage(env, {
    to: body.to,
    template: body.template,
    lang: body.lang,
    components: body.components,
    text: body.body
  });
}

export const onRequestPost = withApi(sendHandler);
