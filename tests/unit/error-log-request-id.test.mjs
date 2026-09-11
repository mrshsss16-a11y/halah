// error_log.request_id عمود NOT NULL — استدعاءات بلا requestId كانت تفشل بصمت (2026-09-11).
//
// كُشف بالسجل الحي لإنتاج هالة: «[hala-error-log-write-failed] D1_ERROR: NOT NULL constraint
// failed: error_log.request_id». ٣٤ استدعاءً (بوابة الجودة، الرؤية، الذكاء الاصطناعي…) تمرّر
// requestId: null، فلم يُحفظ منها سطر قط — ولهذا بدا أن بوابة الجودة لا تعمل.
import { createRunner } from "../_helpers.mjs";
import { logError } from "../../functions/_lib/core/errorLog.js";

const { assert, done } = createRunner("error-log-request-id");

function fakeCtx() {
  const bound = [];
  return {
    bound,
    ctx: { env: { DB: { prepare: () => ({ bind: (...b) => { bound.push(b); return { run: async () => ({}) }; } }) } } }
  };
}

async function main() {
  const realErr = console.error;
  console.error = () => {};
  try {
    const a = fakeCtx();
    logError(a.ctx, { requestId: null, path: "api/copy:quality", code: "COPY_QUALITY_RETRY", internal: "TOO_SHORT", storeId: "m_1" });
    assert(typeof a.bound[0]?.[0] === "string" && /^int-[0-9a-f-]{12}$/.test(a.bound[0][0]), `ELR-1: requestId غائب ⇒ معرّف داخلي لا null (${a.bound[0]?.[0]})`);
    assert(a.bound[0][2] === "COPY_QUALITY_RETRY" && a.bound[0][1] === "m_1", "ELR-2: بقية الأعمدة كما هي");

    const b = fakeCtx();
    logError(b.ctx, { requestId: "abc123", path: "/api/x", code: "X" });
    assert(b.bound[0][0] === "abc123", "ELR-3: requestId الحقيقي يُحفظ كما هو");

    const c1 = fakeCtx(); const c2 = fakeCtx();
    logError(c1.ctx, { requestId: undefined, path: "p", code: "C" });
    logError(c2.ctx, { requestId: "", path: "p", code: "C" });
    assert(c1.bound[0][0] !== c2.bound[0][0] && /^int-/.test(c1.bound[0][0]) && /^int-/.test(c2.bound[0][0]), "ELR-4: undefined والنص الفارغ يأخذان معرّفاً فريداً لكل سطر");
  } finally {
    console.error = realErr;
  }
}

main().then(done);
