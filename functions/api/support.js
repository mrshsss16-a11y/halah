// POST /api/support — the ONE public, cross-origin-embeddable chat endpoint.
// body: { messages: [{role, content}], storeId? }
//
// تنسيق فقط (ARCHITECTURE §١، المرحلة ٤): withApi(cors) ← `domain/support`.
// كل المنطق — التحقق من معرّف المتجر، Turnstile، حد المعدل، الحصة، البرومبت،
// حارس الأسعار، وجسر الذاكرة عبر القنوات — بـ`_lib/domain/support.js`
// و`_lib/ai/prompts/support.js`.
import { withApi } from "../_lib/core/respond.js";
import { corsPreflight } from "../_lib/core/cors.js";
import { replyToWidget } from "../_lib/domain/support.js";

export function onRequestOptions({ request, env }) {
  return corsPreflight(env, request);
}

async function supportHandler(body, env, request) {
  return replyToWidget(env, request, body);
}

export const onRequestPost = withApi(supportHandler, { cors: true });
