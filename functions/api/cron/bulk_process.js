// GET /api/cron/bulk_process — طابور الجملة، يُضرب كل ١٠ دقائق من `cron-worker/`.
//
// المرحلة ٤: تنسيق فقط — حارس السر المشترك ووجود DB بـ`withApi.raw`، والمراحل
// الثلاث (سحب الكتالوج · توليد→بوابة المراجعة · نشر المعتمَد) بـ`domain/bulk.js`.
import { withApi } from "../../_lib/core/respond.js";
import { runBulkTick } from "../../_lib/domain/bulkTick.js";
import { generateProductCopy } from "../../_lib/domain/copy.js";
import { recordHeartbeat } from "../../_lib/core/heartbeat.js";

async function bulkProcessHandler(request, env, requestId, context) {
  const { catalog, revived, generate, publish } = await runBulkTick(env, {
    context,
    requestId,
    generateCopy: generateProductCopy
  });

  await recordHeartbeat(env, {
    job: "bulk_process",
    ok: true,
    note: `gen=${generate.queuedForReview}/${generate.failed} pub=${publish?.published ?? 0}`
  });

  return {
    ok: true,
    catalog,
    revived,
    // مفاتيح متوافقة مع القارئ القديم (picked/done/failed) + الجديدة.
    picked: generate.picked,
    done: generate.queuedForReview,
    failed: generate.failed,
    generate,
    publish
  };
}

export const onRequestGet = withApi.raw(bulkProcessHandler, {
  csrf: false,
  cron: true,
  requireDb: true,
  cronMessage: "معالجة الدفعات غير مفعّلة حالياً على الخادم.",
  logPath: "cron/bulk_process"
});
