export * from './whatsapp.js';
export * from './salla.js';
// zid.js and trendyol.js were removed (deprioritized — see docs/ROADMAP.md).
// The Zid webhook route (functions/api/webhooks/zid.js) was deleted 2026-09-05:
// it processed events with NO signature verification and could relay WhatsApp
// messages to arbitrary numbers from Aura's verified line (SECURITY_AUDIT C1).
// If Zid ships later, rebuild it with HMAC verification like webhooks/salla.js.
