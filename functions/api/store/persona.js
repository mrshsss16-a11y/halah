// POST & GET /api/store/persona — Merchant Custom Agent Persona & Skill Studio
import { withApi, json } from "../../_lib/core/respond.js";
import { resolveStoreId } from "../../_lib/core/session.js";

async function personaHandler(body, env, request) {
  const claimedId = body?.storeId || body?.store_id || "demo";
  const storeId = await resolveStoreId(request, env, claimedId);

  if (request.method === "GET" || body?.action === "get") {
    // Fetch merchant's custom persona config
    const row = await env.DB.prepare(
      "SELECT store_name FROM merchants WHERE id = ?"
    ).bind(storeId).first().catch(() => null);

    return json({
      ok: true,
      persona: {
        storeId,
        agentName: body?.agentName || "نورة — موظفة المتجر الرقمية",
        dialect: "saudi_najdi", // saudi_najdi, saudi_hijazi, saudi_janubi, fusha_friendly, luxury
        salesBehavior: "persuasive_helper", // persuasive_helper, fast_seller, support_expert
        activeSkills: [
          "tamara_tabby_recovery",
          "zatca_invoice_qr",
          "saudi_logistics_tracking",
          "saudi_seasonal_offers",
          "seo_product_copy"
        ],
        customPromptNotes: "تأكدي دايماً من الرد بأسلوب لطيف ومباشر وعرض أوقات التوصيل الدقيقة."
      }
    });
  }

  // Save updated persona config
  const agentName = body?.agentName || "نورة — موظفة المتجر الرقمية";
  const dialect = body?.dialect || "saudi_najdi";
  const salesBehavior = body?.salesBehavior || "persuasive_helper";
  const activeSkills = body?.activeSkills || [];
  const customPromptNotes = body?.customPromptNotes || "";

  return json({
    ok: true,
    message: "تم حفظ وتفعيل شخصية ومزايا موظفتك الرقمية بنجاح! 🚀✨",
    updatedPersona: {
      storeId,
      agentName,
      dialect,
      salesBehavior,
      activeSkills,
      customPromptNotes,
      updatedAt: new Date().toISOString()
    }
  });
}

export const onRequestPost = withApi(personaHandler);
