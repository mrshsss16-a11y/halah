// P9 — سجل تدقيق الأدمن (migrations/0023). يُستدعى بعد requireAdmin بكل نقطة أدمن.
//
// الكتابة fire-and-forget عبر waitUntil: فشل السجل لا يجوز أن يُسقط رد الأدمن — لكنه
// يُسجَّل بـerror_log حتى لا يمرّ صامتاً (سجل تدقيق يفشل بصمت = لا سجل).
// لا PII: admin_email هوية الأدمن نفسه، والهدف merchant_id فقط.
import { logError } from "./errorLog.js";

export function recordAdminAction(context, { admin, action, path, targetMerchantId = null, requestId = null }) {
  const db = context?.env?.DB;
  if (!db || !admin?.email) return;
  const write = db
    .prepare(`INSERT INTO audit_log (admin_email, action, path, target_merchant_id, request_id) VALUES (?, ?, ?, ?, ?)`)
    .bind(String(admin.email).slice(0, 200), String(action || "read").slice(0, 60), String(path || "").slice(0, 120), targetMerchantId ? String(targetMerchantId).slice(0, 60) : null, requestId)
    .run()
    .catch((e) => logError(context, { requestId, path: "core/auditLog", code: "AUDIT_LOG_WRITE_FAILED", internal: e?.message || String(e) }));
  if (context?.waitUntil) context.waitUntil(write);
}
