/**
 * Dead Letter Queue (DLQ) for failed webhooks.
 * Logs failed webhooks to D1 database for later retry or analysis.
 */

export async function logFailedWebhook(env, { platform, event, merchantId, payload, errorReason }) {
  if (!env.DB) {
    console.warn("DB not available in env, cannot log failed webhook.");
    return false;
  }

  try {
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const query = `
      INSERT INTO webhook_log (platform, event_type, merchant_id, payload, status, error_reason, created_at)
      VALUES (?, ?, ?, ?, 'failed', ?, datetime('now'))
    `;
    
    await env.DB.prepare(query)
      .bind(platform, event, merchantId, payloadStr, errorReason)
      .run();
      
    return true;
  } catch (err) {
    console.error("Failed to log webhook to DLQ:", err);
    return false;
  }
}

export async function getFailedWebhooks(env, merchantId) {
  if (!env.DB) {
    console.warn("DB not available in env, cannot get failed webhooks.");
    return [];
  }

  try {
    const query = `
      SELECT * FROM webhook_log
      WHERE merchant_id = ? AND status = 'failed'
      ORDER BY created_at DESC
    `;
    
    const { results } = await env.DB.prepare(query)
      .bind(merchantId)
      .all();
      
    return results || [];
  } catch (err) {
    console.error("Failed to retrieve failed webhooks:", err);
    return [];
  }
}
