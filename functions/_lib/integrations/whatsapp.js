// WhatsApp Business Cloud API (Meta) client.
// Send:  POST https://graph.facebook.com/v21.0/{phone_number_id}/messages
// Auth:  Bearer WHATSAPP_TOKEN (permanent system-user token)
// Inbound webhook signature: X-Hub-Signature-256 = "sha256=" + HMAC(app_secret, rawBody)
//
// All secrets are optional — waConfigured() lets callers degrade gracefully
// when the integration isn't set up yet.
const GRAPH = "https://graph.facebook.com/v21.0";

export function waConfigured(env) {
  return Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID);
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
export async function sendWaText(env, { to, body }) {
  if (!waConfigured(env)) throw new Error("WhatsApp غير مفعّل — أضف WHATSAPP_TOKEN و WHATSAPP_PHONE_ID.");
  const res = await fetch(`${GRAPH}/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
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
export async function sendWaTemplate(env, { to, template, lang = "ar", components = [] }) {
  if (!waConfigured(env)) throw new Error("WhatsApp غير مفعّل.");
  const res = await fetch(`${GRAPH}/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
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
export async function sendWaInteractiveList(env, { to, bodyText, buttonText, rows }) {
  if (!waConfigured(env)) throw new Error("WhatsApp غير مفعّل — أضف WHATSAPP_TOKEN و WHATSAPP_PHONE_ID.");
  const res = await fetch(`${GRAPH}/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
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
      for (const msg of value.messages || []) {
        const contact = contacts.find((c) => c.wa_id === msg.from);
        const listReply = msg?.interactive?.type === "list_reply" ? msg.interactive.list_reply : null;
        out.push({
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
export async function getWaMedia(env, mediaId) {
  if (!waConfigured(env)) throw new Error("WhatsApp غير مفعّل.");
  
  const res = await fetch(`${GRAPH}/${mediaId}`, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` }
  });
  const data = await res.json();
  if (!res.ok || !data.url) throw new Error(`whatsapp media GET failed: ${res.status}`);
  
  const dlRes = await fetch(data.url, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` }
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
export function parseEchoes(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      for (const echo of value?.message_echoes || []) {
        out.push({
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
