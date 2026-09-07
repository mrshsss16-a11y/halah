// WhatsApp Business Cloud API (Meta) client.
// Send:  POST https://graph.facebook.com/v21.0/{phone_number_id}/messages
// Inbound webhook signature: X-Hub-Signature-256 = "sha256=" + HMAC(app_secret, rawBody)
//
// MULTI-TENANCY: every send takes an optional `conn` — a wa_connections row for
// the merchant who owns that number (see migrations/0013_wa_connections.sql).
// When `conn` is present we use THAT merchant's own phone_number_id + business
// token, so their customers see the merchant's name, not Aura's.
// When `conn` is absent we fall back to env.WHATSAPP_* — Aura's own line, used
// for Aura's own outreach (support replies, consultation reminders).
//
// Sending every merchant's traffic through one shared number violates WhatsApp
// policy (one number messaging many businesses' customers), tanks the quality
// rating, and gets the number banned — taking every merchant down at once.
const GRAPH = "https://graph.facebook.com/v21.0";

// SSRF: أي URL لم يبنِه كودنا (يأتي من رد Graph أو من ويبهوك أو من D1) يجب أن
// يُثبَّت مضيفه قبل أن نلصق به توكن التاجر. رابط تنزيل الوسائط تحديداً يأتي من رد
// Graph نفسه (`data.url`)، فلو تلوّث ذلك الرد ذهب توكن الأعمال لمضيف المهاجم.
// القائمة صريحة — لا أنماط عامة ولا "ينتهي بـfacebook.com" (يمرّر evilfacebook.com).
const WA_ALLOWED_HOSTS = new Set([
  "graph.facebook.com",
  "lookaside.fbsbx.com",
  "mmg.whatsapp.net"
]);

/** True for host itself or any subdomain of it — نقطة الفصل إلزامية. */
function hostAllowed(hostname) {
  if (WA_ALLOWED_HOSTS.has(hostname)) return true;
  return hostname.endsWith(".fbcdn.net") || hostname === "fbcdn.net";
}

/**
 * fail closed: يرمي قبل أي طلب لو المخطط ليس https أو المضيف خارج القائمة.
 * يجب استدعاؤه **قبل** بناء ترويسة Authorization — لا يُرسَل التوكن إطلاقاً.
 */
export function assertWaUrlAllowed(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    throw new Error("رابط واتساب غير صالح — رُفض قبل إرسال أي بيانات اعتماد.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`مخطط غير مسموح (${parsed.protocol}) — رُفض قبل إرسال التوكن.`);
  }
  if (!hostAllowed(parsed.hostname)) {
    throw new Error(`مضيف غير مسموح (${parsed.hostname}) — رُفض قبل إرسال توكن التاجر.`);
  }
  return parsed.toString();
}

/**
 * Resolve which credentials to send with. A merchant connection always wins;
 * env is the fallback for Aura's own line.
 */
function waCreds(env, conn) {
  if (conn?.phone_number_id && conn?.business_token) {
    return { phoneId: conn.phone_number_id, token: conn.business_token };
  }
  if (env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID) {
    return { phoneId: env.WHATSAPP_PHONE_ID, token: env.WHATSAPP_TOKEN };
  }
  return null;
}

/** True when we can send at all — either as this merchant, or as Aura. */
export function waConfigured(env, conn = null) {
  return Boolean(waCreds(env, conn));
}

/** Verify the X-Hub-Signature-256 header against the raw request body. */
export async function verifyWaSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) return false; // Fail closed: no secret means we cannot verify, so reject.
  if (!signatureHeader) return false;
  const expected = signatureHeader.replace(/^sha256=/, "");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (computed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** Send a free-form text message (only valid inside the 24h service window). */
export async function sendWaText(env, { to, body, conn = null }) {
  const creds = waCreds(env, conn);
  if (!creds) throw new Error("WhatsApp غير مفعّل — أضف WHATSAPP_TOKEN و WHATSAPP_PHONE_ID.");
  const res = await fetch(assertWaUrlAllowed(`${GRAPH}/${encodeURIComponent(creds.phoneId)}/messages`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: body.slice(0, 4000) }
    })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`whatsapp send failed: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data?.messages?.[0]?.id;
}

/** Send an approved template (for messages outside the 24h window). */
export async function sendWaTemplate(env, { to, template, lang = "ar", components = [], conn = null }) {
  const creds = waCreds(env, conn);
  if (!creds) throw new Error("WhatsApp غير مفعّل.");
  const res = await fetch(assertWaUrlAllowed(`${GRAPH}/${encodeURIComponent(creds.phoneId)}/messages`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name: template, language: { code: lang }, components }
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`whatsapp template failed: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data?.messages?.[0]?.id;
}

/** Sends an interactive list message — up to 10 tap-to-choose rows in one section. */
export async function sendWaInteractiveList(env, { to, bodyText, buttonText, rows, conn = null }) {
  const creds = waCreds(env, conn);
  if (!creds) throw new Error("WhatsApp غير مفعّل — أضف WHATSAPP_TOKEN و WHATSAPP_PHONE_ID.");
  const res = await fetch(assertWaUrlAllowed(`${GRAPH}/${encodeURIComponent(creds.phoneId)}/messages`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: bodyText },
        action: {
          button: buttonText,
          // WhatsApp's Cloud API hard-caps interactive lists at 10 rows total —
          // truncate defensively so a future WEEKLY_SLOTS growth bug fails safe
          // (a shorter list) instead of a hard 400 from Meta that drops the
          // whole send.
          sections: [{ title: "الفتحات المتاحة", rows: rows.slice(0, 10) }]
        }
      }
    })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`whatsapp interactive list failed: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data?.messages?.[0]?.id;
}

/** Extract inbound messages from a webhook payload into a simple shape. */
export function parseInbound(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const contacts = value.contacts || [];
      // Which of OUR numbers received this — the key that maps a message to the
      // merchant who owns it. Was previously discarded, which is why every
      // message got attributed to one hardcoded merchant.
      const phoneNumberId = value?.metadata?.phone_number_id || null;
      for (const msg of value.messages || []) {
        const contact = contacts.find((c) => c.wa_id === msg.from);
        const listReply = msg?.interactive?.type === "list_reply" ? msg.interactive.list_reply : null;
        out.push({
          phoneNumberId,
          from: msg.from,
          name: contact?.profile?.name,
          text: msg?.text?.body,
          type: msg.type,
          id: msg.id,
          audioId: msg.type === "audio" ? msg?.audio?.id : null,
          imageId: msg.type === "image" ? msg?.image?.id : null,
          imageCaption: msg.type === "image" ? msg?.image?.caption : null,
          listReplyId: listReply?.id,
          listReplyTitle: listReply?.title
        });
      }
    }
  }
  return out;
}

/** Get media metadata and download its bytes. */
export async function getWaMedia(env, mediaId, conn = null) {
  const creds = waCreds(env, conn);
  if (!creds) throw new Error("WhatsApp غير مفعّل.");

  const metaUrl = assertWaUrlAllowed(`${GRAPH}/${encodeURIComponent(mediaId)}`);
  const res = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${creds.token}` }
  });
  const data = await res.json();
  if (!res.ok || !data.url) throw new Error(`whatsapp media GET failed: ${res.status}`);

  // `data.url` يأتي من رد Graph — ليس من كودنا. ثبّت مضيفه قبل لصق التوكن به.
  const dlUrl = assertWaUrlAllowed(data.url);
  const dlRes = await fetch(dlUrl, {
    headers: { Authorization: `Bearer ${creds.token}` }
  });
  if (!dlRes.ok) throw new Error(`whatsapp media download failed: ${dlRes.status}`);
  
  return await dlRes.arrayBuffer();
}

/**
 * Extract "echo" events from a webhook payload — messages sent from the
 * WhatsApp Business consumer app itself (or a linked companion device) on a
 * Coexistence-enabled number, not via this Cloud API. Meta's smb_message_echoes
 * field: object -> entry[] -> changes[] -> value -> message_echoes[].
 * Without this, anything a human types from the phone app vanishes from our
 * conversation history/RAG context — the AI would "forget" half the thread.
 */
/**
 * Coexistence-specific: SMB App Data API. After a merchant connects an
 * existing WhatsApp Business App number via Embedded Signup, Meta gives us a
 * ~24h window to pull their existing contacts + message history before they'd
 * have to redo onboarding. Without this call the merchant's number connects
 * fine but shows up empty in our dashboard — no past customers, no history —
 * even though their phone still has everything.
 *
 * Docs: developers.facebook.com/documentation/business-messaging/whatsapp/
 *       embedded-signup/onboarding-business-app-users
 *
 * Fire-and-forget from the caller's `context.waitUntil` — this can take a
 * while and must never hold up the connect response the browser is waiting on.
 * Best-effort: failures here don't undo the connection, they just mean the
 * merchant starts with an empty history (same as if they'd connected a new
 * number) and new messages still flow in normally from that point on.
 */
export async function requestCoexistenceSync(wabaId, businessToken, syncType) {
  const res = await fetch(assertWaUrlAllowed(`${GRAPH}/${encodeURIComponent(wabaId)}/smb_app_data`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${businessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ messaging_product: "whatsapp", sync_type: syncType })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`smb_app_data ${syncType} failed: ${res.status} ${detail.slice(0, 300)}`);
  }
}

/** Runs both required syncs (contacts first, then history) for a freshly connected WABA. */
export async function syncCoexistenceHistory(wabaId, businessToken) {
  await requestCoexistenceSync(wabaId, businessToken, "smb_app_state_sync");
  await requestCoexistenceSync(wabaId, businessToken, "history");
}

export function parseEchoes(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const phoneNumberId = value?.metadata?.phone_number_id || null;
      for (const echo of value?.message_echoes || []) {
        out.push({
          phoneNumberId,
          to: echo.to,
          text: echo.type === "text" ? echo?.text?.body : null,
          type: echo.type,
          id: echo.id
        });
      }
    }
  }
  return out;
}
