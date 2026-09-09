// مجال الأسئلة الشائعة: معرفة هالة نفسها (`hala_faq`، مصدر RAG لشخصية الدعم)
// وأسئلة كل تاجر (`merchant_faqs`). نُقل من core/db.js بالمرحلة ٣ بلا تغيير سلوكي.

// ── Hala's own FAQ knowledge (RAG source of truth for the support persona) ──

export async function listHalaFaq(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, question, answer FROM hala_faq ORDER BY id"
  ).all();
  return results || [];
}

export async function saveHalaFaqEntry(env, { id, question, answer }) {
  if (id) {
    await env.DB.prepare(
      "UPDATE hala_faq SET question = ?, answer = ?, updated_at = datetime('now') WHERE id = ?"
    )
      .bind(question, answer, id)
      .run();
    return id;
  }
  const res = await env.DB.prepare(
    "INSERT INTO hala_faq (question, answer) VALUES (?, ?)"
  )
    .bind(question, answer)
    .run();
  return res.meta.last_row_id;
}

export async function deleteHalaFaqEntry(env, id) {
  await env.DB.prepare("DELETE FROM hala_faq WHERE id = ?").bind(id).run();
}

// ── أسئلة التاجر الشائعة (تدريب الوكيل من لوحة الوكلاء) ──────────────────────
// كل استعلام هنا مشروط بـmerchant_id: سؤال تاجر لا يظهر — ولا يُحذف — من حساب
// تاجر آخر حتى لو خمّن الـid.
export async function listMerchantFaqs(env, merchantId) {
  if (!env?.DB || !merchantId) return [];
  const { results } = await env.DB.prepare(
    "SELECT id, question, answer, updated_at FROM merchant_faqs WHERE merchant_id = ? ORDER BY updated_at DESC LIMIT 200"
  )
    .bind(merchantId)
    .all()
    .catch(() => ({ results: [] }));
  return results || [];
}

export async function saveMerchantFaq(env, merchantId, { id, question, answer }) {
  if (!env?.DB || !merchantId) return null;
  if (id) {
    // شرط merchant_id بالتحديث نفسه — لا نتحقق ثم نكتب (سباق)، بل نجعل
    // الكتابة مستحيلة أصلاً على صف تاجر آخر.
    await env.DB.prepare(
      "UPDATE merchant_faqs SET question = ?, answer = ?, updated_at = datetime('now') WHERE id = ? AND merchant_id = ?"
    )
      .bind(question, answer, id, merchantId)
      .run();
    return id;
  }
  const res = await env.DB.prepare(
    "INSERT INTO merchant_faqs (merchant_id, question, answer, updated_at) VALUES (?, ?, ?, datetime('now'))"
  )
    .bind(merchantId, question, answer)
    .run();
  return res?.meta?.last_row_id ?? null;
}

export async function deleteMerchantFaq(env, merchantId, id) {
  if (!env?.DB || !merchantId || !id) return;
  await env.DB.prepare("DELETE FROM merchant_faqs WHERE id = ? AND merchant_id = ?")
    .bind(id, merchantId)
    .run();
}
