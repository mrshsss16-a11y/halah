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
  if (!signatureHeader || !appSecret) return false;
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
  return data.messages && data.messages[0] && data.messages[0].id;
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
  return data.messages && data.messages[0] && data.messages[0].id;
}

/** Extract inbound messages from a webhook payload into a simple shape. */
export function parseInbound(payload) {
  const out = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const contacts = value.contacts || [];
      for (const msg of value.messages || []) {
        const contact = contacts.find((c) => c.wa_id === msg.from);
        out.push({
          from: msg.from,
          name: contact && contact.profile && contact.profile.name,
          text: msg.text && msg.text.body,
          type: msg.type,
          id: msg.id
        });
      }
    }
  }
  return out;
}
