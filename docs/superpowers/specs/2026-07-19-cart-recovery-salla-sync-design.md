# Cart Recovery via WhatsApp + Salla Product Sync — Design

**Date:** 2026-07-19
**Status:** Approved by owner (chat session)

## Problem

Two advertised product features are incomplete:

1. **Abandoned-cart recovery**: `abandoned.cart` webhooks store carts in D1 (`abandoned_carts`), and the dashboard lists them — but nothing can actually send the recovery WhatsApp message. `/api/whatsapp/send` is admin-only and unused by any UI.
2. **Chat grounding for Salla merchants**: `chat.js` grounds replies in `product_sync`, but only Trendyol writes to that table. A Salla merchant's chat assistant knows none of their products or prices.

## Decisions (owner-confirmed)

- Recovery send is **manual-first**: a button per cart in the dashboard. Automation (cron) is explicitly out of scope for this iteration.
- No approved Meta template is known to exist → the send path must handle both cases: free-form text inside the 24h service window, template outside it, and a clear merchant-facing error when the template is not configured.
- Salla product sync **piggybacks on the dashboard overview fetch** — no new UI, no extra Salla API calls. Webhook-driven sync is a later enhancement.
- Architecture approach A: extend existing patterns (thin endpoint + db.js helpers), no new infrastructure.

## Components

### 1. `functions/api/store/recover-cart.js` (new)

`POST /api/store/recover-cart` — body: `{ storeId, cartId, force? }`, wrapped in `withApi`.

Flow:
1. `resolveStoreId(request, env, body.storeId)` — inherits the tenant-isolation rule (session wins; account-holding stores require login).
2. `getAbandonedCart(env, merchantId, cartId)` — single query scoped by `merchant_id`; another merchant's cart is indistinguishable from a missing one (`{ ok:false, error: "السلة غير موجودة." }`).
3. Guards: `waConfigured(env)` else configuration error; cart has `customer_phone` else clear error; `recovery_sent_at` already set and `force !== true` → `{ ok:false, code:"ALREADY_SENT" }` so the UI can ask for confirmation.
4. Send:
   - `isWaWindowOpen(env, env.WHATSAPP_MERCHANT_ID || "hala", phone)` — the 24h window is a property of the (platform phone number ↔ customer) pair, and inbound messages are recorded under the platform scope, so the check must use that scope (checking under the merchant's scope would always report "closed"). → **open**: `sendWaText` with a fixed Arabic message (greeting with customer name, store name, first 3 item names, total). Deterministic — no AI call, no credits consumed.
   - **closed**: `env.WHATSAPP_RECOVERY_TEMPLATE` set → `sendWaTemplate` with components (customer name, store name, total). Not set → `{ ok:false, code:"TEMPLATE_MISSING", error }` with guidance text (create the template in Meta Business Manager, then set the secret).
5. `recordWaOutbound` under the **merchant's own** `merchantId` (not `"hala"`) so per-merchant conversation history stays isolated; then `markCartRecoverySent`.
6. Return `{ ok:true, kind: "text"|"template" }`.

### 2. `functions/_lib/db.js` (two helpers)

- `getAbandonedCart(env, merchantId, cartId)` — `SELECT * FROM abandoned_carts WHERE id = ? AND merchant_id = ?`.
- `markCartRecoverySent(env, merchantId, cartId)` — sets `recovery_sent_at = datetime('now')`, same WHERE clause.

### 3. `migrations/0008_cart_recovery.sql` (new)

```sql
ALTER TABLE abandoned_carts ADD COLUMN recovery_sent_at TEXT;
```

`status` keeps its existing CHECK values (`open`/`recovered`/`expired`); "recovery message sent" is a separate fact from "cart recovered", and SQLite cannot alter a CHECK constraint in place.

### 4. `functions/api/store/overview.js` (Salla → product_sync)

After a successful `listProducts` fetch, upsert the mapped products into `product_sync` with `platform='salla'`, `external_id = product id`, `sync_status='synced'`, in one `env.DB.batch`. Wrapped in its own try/catch reporting to `result.errors.sallaSync` — a sync failure never blanks the dashboard (same degrade pattern as every other section). `chat.js` picks the rows up with zero changes (it already reads all platforms for the merchant).

### 5. `dashboard.html` (abandoned-carts section)

- Per-cart button **"استرداد عبر واتساب"** calling the endpoint with the stored `hala_store_id`.
- Button states: sending (disabled) / sent (`recovery_sent_at` present → shows "أُرسلت" + confirm-resend flow passing `force:true`) / error toast showing the endpoint's Arabic error, with the `TEMPLATE_MISSING` guidance rendered fully.
- `overview.js` response already includes carts; add `recoverySentAt` to the mapped cart shape.

## Proposed Meta template (for owner to submit for approval)

Name: `cart_recovery_ar`, language `ar`, category MARKETING. Body:

> مرحباً {{1}} 👋 لاحظنا أنك تركت سلة مشترياتك في متجر {{2}} وفيها منتجات بقيمة {{3}} ريال. أكمل طلبك الآن قبل نفاد الكمية!

Variables: 1 = customer name (fallback "عميلنا العزيز"), 2 = store name, 3 = total. Once approved, set `WHATSAPP_RECOVERY_TEMPLATE=cart_recovery_ar` via `wrangler pages secret put`.

## Security

- Tenant isolation: endpoint goes through `resolveStoreId` + merchant-scoped cart lookup; no cross-merchant reads or sends possible.
- The admin-only gate on `/api/whatsapp/send` is untouched; this endpoint can only message a phone number already present in the merchant's own cart data — it is not a free-form send API.
- Outbound messages go from the platform's single WhatsApp number; message text identifies the merchant's store by name.

## Error handling summary

| Case | Response |
|---|---|
| Cart not found / other merchant's cart | `ok:false`, "السلة غير موجودة." |
| No customer phone on cart | `ok:false`, explanatory Arabic error |
| WhatsApp secrets not configured | `ok:false`, configuration guidance |
| Window closed + no template configured | `ok:false`, `code:TEMPLATE_MISSING`, setup guidance |
| Already sent, no `force` | `ok:false`, `code:ALREADY_SENT` |
| Meta API failure | propagates as `ApiError`-style 502 via `withApi` (logged) |
| Salla product upsert failure in overview | dashboard renders; `errors.sallaSync` populated |

## Testing

- Node runtime tests (mocked `env.DB` + `fetch`, same harness style as this session's crypto/session tests):
  - cart ownership: other merchant's cartId → not found; own cart → proceeds
  - window open → text path; window closed + template → template path; closed + no template → `TEMPLATE_MISSING`
  - duplicate send without `force` → `ALREADY_SENT`; with `force` → sends
  - overview upsert: fetched Salla products land in `product_sync` with `platform='salla'`
- `node --check` on all touched files; manual pass via `npm run dev` with a seeded cart.

## Out of scope (explicit)

- Cron/automatic recovery sends, per-merchant WhatsApp numbers, recovery-conversion tracking (`status='recovered'` automation), Zid support, billing.
