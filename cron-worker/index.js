// Ticks every 10 minutes. Sole job: call the real endpoints on the Pages
// project with the shared secret. All logic (matching bookings, sending
// WhatsApp, health checks) lives in functions/api/cron/*.js — this file
// stays intentionally dumb so there's only one place to update behavior.
async function ping(path, env) {
  const res = await fetch(`https://hala-ai-os.pages.dev${path}`, {
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` }
  });
  const body = await res.text();
  console.log(`[hala-cron] ${path} status=${res.status} body=${body}`);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(ping("/api/cron/reminders", env));
    ctx.waitUntil(ping("/api/cron/healthcheck", env));
  }
};
