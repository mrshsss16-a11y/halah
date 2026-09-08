// POST /api/store/review/list — body: { storeId?, state?, limit? }
// شاشة المراجعة الجماعية للتاجر (المرحلة ٢، docs/COMPLETION_PATH.md).
//
// state: pending (افتراضي) · awaiting_publish · published · publish_failed · rejected.
// كل استعلام يمر بـservices/reviewQueue.js (الوسيط الوحيد لجدول review_queue)
// بـmerchantId من الجلسة — لا من الجسم. الحمولة تُعاد مفكوكة (JSON) حتى تعرض
// الشاشة "الحالي ← المقترح" بلا تفكيك بالمتصفح.
import { withApi } from "../../../_lib/core/respond.js";
import { requireCompletedAccount } from "../../../_lib/core/session.js";
import { listPending, listByState, countByState } from "../../../_lib/services/reviewQueue.js";

const STATES = new Set(["pending", "awaiting_publish", "published", "publish_failed", "rejected"]);

function parsePayload(raw) {
  try {
    const p = JSON.parse(raw);
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

function toView(row) {
  const p = parsePayload(row.payload) || {};
  return {
    id: row.id,
    status: row.status,
    sku: p.sku || null,
    name: p.name || null,
    price: p.price || null,
    category: p.category || null,
    imageUrl: p.imageUrl || null,
    currentDescription: p.currentDescription || null,
    description: p.description || null,
    excerpt: p.copywriting?.excerpt || null,
    highlights: Array.isArray(p.copywriting?.highlights) ? p.copywriting.highlights.slice(0, 8) : [],
    faqs: Array.isArray(p.faqs) ? p.faqs.slice(0, 5) : [],
    seo: p.seo ? { title: p.seo.title || null, seoTitle: p.seo.seoTitle || null, metaDescription: p.seo.metaDescription || null, focusKeyword: p.seo.focusKeyword || null } : null,
    editedAt: p.editedAt || null,
    reviewedAt: row.reviewed_at || null,
    publishedAt: row.published_at || null,
    publishError: row.publish_error || null,
    reviewNote: row.review_note || null,
    createdAt: row.created_at || null
  };
}

async function reviewListHandler(body, env, request) {
  const merchantId = await requireCompletedAccount(request, env, body.storeId);
  const state = STATES.has(body.state) ? body.state : "pending";
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100);

  const rows =
    state === "pending"
      ? await listPending(env, { merchantId, kind: "description", limit })
      : await listByState(env, { merchantId, kind: "description", state, limit });

  const counts = await countByState(env, { merchantId, kind: "description" });

  return { ok: true, state, rows: rows.map(toView), counts };
}

export const onRequestPost = withApi(reviewListHandler);
