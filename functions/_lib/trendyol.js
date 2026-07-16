// Trendyol Marketplace API client.
// Auth: Basic (API key + secret). User-Agent header is MANDATORY —
// "{sellerId} - SelfIntegration" — requests without it get 403.
// Prod:  https://apigw.trendyol.com/integration
// Stage: https://stageapigw.trendyol.com/integration

const BASES = {
  prod: "https://apigw.trendyol.com/integration",
  stage: "https://stageapigw.trendyol.com/integration"
};

export function tyHeaders(conn) {
  const basic = btoa(`${conn.api_key}:${conn.api_secret}`);
  return {
    Authorization: `Basic ${basic}`,
    "User-Agent": `${conn.seller_id} - SelfIntegration`,
    "content-type": "application/json"
  };
}

export async function tyFetch(conn, path, opts = {}) {
  const base = BASES[conn.environment] || BASES.prod;
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: { ...tyHeaders(conn), ...(opts.headers || {}) }
  });
  if (res.status === 429) {
    throw new Error("trendyol rate limit (429) — أعد المحاولة بعد قليل");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`trendyol ${path}: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Cheap credential validation: one page of the sellers' addresses endpoint. */
export async function verifyConnection(conn) {
  return tyFetch(conn, `/sellers/${conn.seller_id}/addresses`);
}

/** Async product push — 1000 items max per request; returns batchRequestId. */
export async function createProducts(conn, items) {
  if (items.length > 1000) throw new Error("حد Trendyol: 1000 منتج بالطلب الواحد");
  return tyFetch(conn, `/product/sellers/${conn.seller_id}/v2/products`, {
    method: "POST",
    body: JSON.stringify({ items })
  });
}

export async function getBatchResult(conn, batchRequestId) {
  return tyFetch(conn, `/product/sellers/${conn.seller_id}/products/batch-requests/${batchRequestId}`);
}

/** Price/stock update — same payload may not repeat within 15 minutes (caller enforces via payload_hash). */
export async function updatePriceAndInventory(conn, items) {
  if (items.length > 1000) throw new Error("حد Trendyol: 1000 عنصر بالطلب الواحد");
  return tyFetch(conn, `/inventory/sellers/${conn.seller_id}/products/price-and-inventory`, {
    method: "POST",
    body: JSON.stringify({ items })
  });
}

export async function getShipmentPackages(conn, page = 0, size = 50) {
  return tyFetch(conn, `/order/sellers/${conn.seller_id}/orders?page=${page}&size=${size}`);
}
