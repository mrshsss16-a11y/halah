// GET /api/widget/config?storeId=... — مظهر الودجت وترحيبه من إعدادات التاجر.
//
// لماذا endpoint منفصل بدل قراءة الإعدادات من `/api/store/persona`: ذاك يتطلب
// حساباً مسجّلاً (إعدادات التاجر)، وهذا يناديه **زائر مجهول** من موقع التاجر.
// فيرجّع حقول العرض فقط — لا تعليمات، لا سياسات، لا رقم تصعيد. أي حقل يُضاف
// هنا يصير علنياً على أي موقع مركّب للودجت.
import { getAgentProfile } from "../../_lib/core/db.js";
import { resolveAllowedOrigin, corsHeaders, corsPreflight } from "../../_lib/core/cors.js";

const DEFAULTS = {
  agentName: "هالة",
  greeting: "هلا والله 👋 وش تبي تعرف؟",
  primaryColor: "#0f172a",
  position: "left",
  logoUrl: null
};

export function onRequestOptions({ request, env }) {
  return corsPreflight(env, request);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const storeId = (url.searchParams.get("storeId") || "hala").slice(0, 40);

  const profile = await getAgentProfile(env, storeId).catch(() => null);

  let appearance = {};
  try {
    appearance = profile?.appearance ? JSON.parse(profile.appearance) : {};
  } catch {
    appearance = {}; // JSON تالف بالإعدادات ما يصح يمنع الودجت من الظهور
  }

  const config = {
    agentName: profile?.agent_name || DEFAULTS.agentName,
    businessName: profile?.business_name || null,
    greeting: appearance.greeting || DEFAULTS.greeting,
    primaryColor: appearance.primaryColor || DEFAULTS.primaryColor,
    position: appearance.position === "right" ? "right" : DEFAULTS.position,
    logoUrl: appearance.logoUrl || DEFAULTS.logoUrl,
    // متوقف = الودجت يختفي بلا تعديل كود الموقع المضيف.
    enabled: profile ? profile.status !== "paused" : true
  };

  return new Response(JSON.stringify(config), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
      ...corsHeaders(resolveAllowedOrigin(request, env))
    }
  });
}
