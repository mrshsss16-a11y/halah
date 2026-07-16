// GET /api/store/config — public, non-secret runtime config for the frontend.
// Tells onboarding whether real Salla install is available (app id configured)
// so it can switch from demo theater to the real install flow.
export async function onRequestGet(context) {
  const appId = context.env.SALLA_APP_ID || null;
  return new Response(
    JSON.stringify({
      sallaInstallUrl: appId ? `https://s.salla.sa/apps/install/${appId}` : null
    }),
    { headers: { "content-type": "application/json" } }
  );
}
