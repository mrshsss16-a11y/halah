import { onRequestPost } from "../functions/api/admin/aura_whatsapp.js";
import { createSessionToken } from "../functions/_lib/core/session.js";

async function runSpeedBenchmark() {
  console.log("⚡ Starting High-Speed Latency Benchmark for Aura WhatsApp Agent...\n");

  const mockAdminEnv = {
    SESSION_SECRET: "test-secret-12345",
    ADMIN_EMAILS: "admin@auramarketing.sa",
    WHATSAPP_TOKEN: "EAAG_MOCK_META_TOKEN_123456",
    WHATSAPP_PHONE_ID: "109876543210123",
    WHATSAPP_VERIFY_TOKEN: "hala-verify-secret",
    DB: {
      prepare: (query) => ({
        bind: (...args) => ({
          first: async () => ({ email: "admin@auramarketing.sa", is_admin: 1 }),
          all: async () => ({ results: [{ question: "ما هي خدمات أورا؟", answer: "تسويق واسترداد سلات." }] }),
          run: async () => ({ meta: { last_row_id: 101 } })
        })
      })
    }
  };

  const adminToken = await createSessionToken(mockAdminEnv, "m_admin_aura");
  const testMessages = [
    "السلام عليكم، وش الخدمات اللي تقدمونها؟",
    "كم استرداد السلات يفرق معي؟",
    "كيف احجز استشارة مجانية مع فريق اورا؟",
    "هل تدعمون متجر سلة وزد؟",
    "أبي اتبع شحنتي بالواتساب",
    "اريد تتبع الشحنة",
    "عندكم خصم يوم التأسيس واليوم الوطني؟",
    "كيف اقسط المبيعات عبر تمارا وتابي؟",
    "كيف احصل على الفاتورة الضريبية ZATCA؟",
    "شكراً لكم على الخدمة المتميزة!"
  ];

  const latencies = [];

  for (let i = 0; i < testMessages.length; i++) {
    const msg = testMessages[i];
    const req = new Request("http://localhost:8788/api/admin/aura_whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": `hala_session=${adminToken}` },
      body: JSON.stringify({ action: "test_agent", message: msg })
    });

    const start = performance.now();
    const res = await onRequestPost({ request: req, env: mockAdminEnv });
    const data = await res.json();
    const duration = performance.now() - start;

    latencies.push(duration);
    console.log(`[Message ${i + 1}/${testMessages.length}] "${msg}"`);
    console.log(`⚡ Response Speed: ${duration.toFixed(2)}ms | Source: ${data.source}`);
    console.log(`💬 Reply: "${data.agentReply.slice(0, 70)}..."\n`);
  }

  const avgLatency = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2);
  const minLatency = Math.min(...latencies).toFixed(2);
  const maxLatency = Math.max(...latencies).toFixed(2);

  console.log("=================================================");
  console.log("📊 AURA WHATSAPP AGENT SPEED BENCHMARK REPORT");
  console.log("=================================================");
  console.log(`✅ Total Test Messages: ${testMessages.length}`);
  console.log(`⚡ Average Latency:    ${avgLatency}ms`);
  console.log(`🚀 Fastest Response:   ${minLatency}ms`);
  console.log(`⏱️ Slowest Response:   ${maxLatency}ms`);
  console.log("=================================================");
}

runSpeedBenchmark().catch(console.error);
