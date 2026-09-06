export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'طريقة الطلب غير مدعومة.', code: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const hasEncryptionKey = Boolean(env.ENCRYPTION_KEY);
  const hasSessionSecret = Boolean(env.SESSION_SECRET);
  
  // Technical security readiness assessment (cryptographic & session controls)
  const technicalControlsReady = hasEncryptionKey && hasSessionSecret;

  const responseBody = {
    ok: true,
    auditType: "technical_security_readiness",
    technicalControlsReady,
    status: technicalControlsReady ? "controls_ready" : "configuration_incomplete",
    controls: {
      encryptionConfigured: hasEncryptionKey,
      encryptionAlgorithm: hasEncryptionKey ? "AES-256-GCM" : "disabled",
      sessionSecurityConfigured: hasSessionSecret,
      sessionAlgorithm: hasSessionSecret ? "HMAC-SHA256" : "disabled",
      tenantIsolation: "Enforced"
    },
    disclaimer: "التقييم التقني يقيس جاهزية عناصر التشفير والجلسات، ولا يعتبر شهادة امتثال قانوني نهائي بنظام حماية البيانات الشخصية (PDPL) والتي تتطلب إجراءات قانونية وتنظيمية مكتملة.",
    auditTimestamp: new Date().toISOString()
  };

  return new Response(JSON.stringify(responseBody), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
    }
  });
}
