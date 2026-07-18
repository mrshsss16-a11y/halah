// POST /api/admin/faq
// body: { action: "list" } | { action: "save", id?, question, answer } | { action: "delete", id } | { action: "reembed" }
import { withApi } from "../../_lib/respond.js";
import { requireAdmin } from "../../_lib/session.js";
import { listHalaFaq, saveHalaFaqEntry, deleteHalaFaqEntry } from "../../_lib/db.js";
import { reembedHalaFaq, deleteHalaFaqEmbedding } from "../../_lib/memory.js";

async function faqHandler(body, env, request) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };

  const action = body.action;
  if (action === "list") {
    return { ok: true, rows: await listHalaFaq(env) };
  }
  if (action === "save") {
    const question = (body.question || "").toString().trim().slice(0, 500);
    const answer = (body.answer || "").toString().trim().slice(0, 2000);
    if (!question || !answer) return { ok: false, error: "السؤال والجواب مطلوبين." };
    const id = await saveHalaFaqEntry(env, { id: body.id || null, question, answer });
    return { ok: true, id };
  }
  if (action === "delete") {
    if (!body.id) return { ok: false, error: "id مفقود." };
    await deleteHalaFaqEntry(env, body.id);
    await deleteHalaFaqEmbedding(env, body.id);
    return { ok: true };
  }
  if (action === "reembed") {
    const rows = await listHalaFaq(env);
    const count = await reembedHalaFaq(env, rows);
    return { ok: true, reembedded: count };
  }
  return { ok: false, error: "action غير معروف." };
}

export const onRequestPost = withApi(faqHandler);
