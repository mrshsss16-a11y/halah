// POST /api/stats — أرقام حقيقية فقط (لا دليل اجتماعي مفبرك — نفس القاعدة
// المفروضة على الشخصية نفسها بـ`_lib/ai/persona.js`).
//
// المرحلة ٤: تنسيق فقط — بوابة CSRF من withApi، والاستعلامات بـ`domain/analytics.js`.
import { withApi } from "../_lib/core/respond.js";
import { publicStats } from "../_lib/domain/analytics.js";
import { logError } from "../_lib/core/errorLog.js";

async function statsHandler(body, env) {
  return publicStats(env, (key, err) =>
    logError({ env }, { requestId: null, path: "stats", code: "STATS_QUERY_FAILED", internal: `${key}: ${err?.message || err}` })
  );
}

export const onRequestPost = withApi(statsHandler);
