import { createRunner, readComposedPage } from "../_helpers.mjs";

const { assert, done } = createRunner("review");

async function main() {
  // ── APPROVE-*: راجع واعتمد بعد التوليد (لوحة التاجر) ───────────────
  {
    const { readFileSync } = await import("node:fs");
    const dashSrc = await readComposedPage("dashboard");

    assert(
      /راجع الوصف — عدّله إن حبيت، ثم اعتمد/.test(dashSrc),
      "APPROVE-1: عنوان المراجعة صريح فوق الوصف المولَّد"
    );
    assert(
      /id="publishBtn"[\s\S]{0,400}اعتمد وانشر على سلة/.test(dashSrc)
        && /id="regenBtn"[\s\S]{0,400}أعد التوليد/.test(dashSrc),
      "APPROVE-2: الزران متجاوران — «اعتمد وانشر» و«أعد التوليد»"
    );
    assert(
      /function regenerateCopy\(\)[\s\S]{0,300}generateCopy\(\);/.test(dashSrc)
        && /onclick="publishToSalla\(\)"/.test(dashSrc),
      "APPROVE-3: الزران يستدعيان الدالتين الموجودتين بلا إعادة كتابة"
    );
    // publishing صار S.publishing بحالة مشتركة state.js بعد التقسيم.
    assert(
      /publishing:\s*false/.test(dashSrc)
        && /if \(S\.publishing\) return;/.test(dashSrc)
        && /btnText\.innerText = (['"])جاري النشر…\1/.test(dashSrc),
      "APPROVE-4: منع النشر المزدوج — علم قبل أي await + تعطيل الزر"
    );
    assert(
      /S\.publishing = false;[\s\S]{0,200}btn\.disabled = false;/.test(dashSrc),
      "APPROVE-5: الزر يعود قابلاً للضغط بعد انتهاء الطلب"
    );
    assert(
      /(['"])تم النشر على سلة ✅\1/.test(dashSrc) && /bg-green-50/.test(dashSrc),
      "APPROVE-6: حالة نجاح خضراء صريحة"
    );
    assert(
      /fb\.innerHTML = (['"])تم النشر على سلة ✅\1[\s\S]{0,200}escHtml\(t\.name\)/.test(dashSrc),
      "APPROVE-7: اسم المنتج برسالة النجاح مهرَّب بـescHtml"
    );
    assert(
      !/https:\/\/[^"'\s]*\/p\d|productUrl|store_url/.test(dashSrc),
      "APPROVE-8: لا رابط منتج مخترع — البيانات لا تتضمن دومين المتجر"
    );
  }

  // ── المرحلة ٢ (docs/COMPLETION_PATH.md) — الجملة عبر بوابة المراجعة ─────
  {
    const { readFileSync } = await import("node:fs");
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

    // BULK-1 — الفصل: مسار التوليد لا يستورد سلة إطلاقاً، وينشر حصراً عبر publishApproved.
    // المرحلة ٤: نقطة الدخول حارس + استدعاء واحد؛ المراحل الثلاث بـdomain/bulk.js.
    const cron = read("../../functions/_lib/domain/bulkTick.js");
    assert(
      !/integrations\/salla\.js/.test(cron) && !/updateProductBySku/.test(cron)
        && !/integrations\/salla\.js/.test(read("../../functions/api/cron/bulk_process.js")),
      "BULK-1: مسار الجملة لا يستورد سلة ولا updateProductBySku — التوليد صفر كتابة على سلة"
    );
    assert(
      /enqueue\(env, \{ merchantId: item\.merchant_id, kind: "description"/.test(cron) && /publishApproved\(env, row\)/.test(cron),
      "BULK-2: التوليد يدخل review_queue بنوع description، والنشر يمرّ بـpublishApproved فقط"
    );
    assert(
      /claimNextPublishMerchant/.test(cron) && /stoppedByRateLimit = true/.test(cron) && /SALLA_DELAY_MS = 1100/.test(cron),
      "BULK-3: النشر متجر واحد لكل تِك، فاصل ≥ ١.١ث، توقف عند ٤٢٩"
    );

    // BULK-4 — publishApproved: وصف معتمد يُكتب بالـSKU، و٤٢٩ يرفع retryAfter، و٤٢٢ يسقط للوصف وحده.
    const pubSrc = read("../../functions/_lib/domain/publish.js");
    assert(
      /row\?\.kind === "description"/.test(pubSrc) && /status === 429/.test(pubSrc) && /status === 422 && fallback/.test(pubSrc) && /buildSallaProductFields/.test(pubSrc) && /markPublished/.test(pubSrc),
      "BULK-4: publishApproved يعالج description بالـSKU مع ٤٢٩→retryAfter و٤٢٢→الوصف وحده ويعلّم الكتالوج"
    );

    // BULK-5 — approveMany: كل صف بشرط pending + merchant_id؛ فشل صف لا يوقف الباقي ولا يُخفى.
    const { approveMany, updatePayload, countByState, listByState } = await import("../../functions/_lib/domain/review.js");
    const seen = [];
    const rqDb = {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => {
                if (/UPDATE review_queue\s+SET status = \?/.test(sql)) {
                  seen.push({ id: args[3], mid: args[4] });
                  // الصف ٣ "مُراجَع مسبقاً" — صفر صفوف متأثرة.
                  return args[3] === 3 ? null : { id: args[3], merchant_id: args[4], kind: "description", status: args[0], payload: "{}" };
                }
                if (/SELECT payload FROM review_queue/.test(sql)) {
                  return args[0] === 7 ? { payload: JSON.stringify({ sku: "S1", description: "قديم" }) } : null;
                }
                if (/UPDATE review_queue SET payload/.test(sql)) {
                  return { id: args[1], merchant_id: args[2], kind: "description", payload: args[0], status: "pending" };
                }
                if (/SUM\(status = 'pending'\)/.test(sql)) {
                  return { pending: 2, awaiting_publish: 1, published: 3, publish_failed: 0, rejected: 1 };
                }
                return null;
              },
              all: async () => ({ results: [] }),
              run: async () => ({ meta: {} })
            };
          }
        };
      }
    };
    const many = await approveMany({ DB: rqDb }, { merchantId: "m_a", ids: [1, 3, 5], reviewedBy: "merchant:m_a" });
    assert(
      many.approved.length === 2 && many.failed.length === 1 && many.failed[0].id === 3 && seen.every((s) => s.mid === "m_a" && /UPDATE/.test("UPDATE")),
      "BULK-5: approveMany يعتمد ٢ ويُبلّغ فشل الثالث صراحة، وكل تحديث مقيّد بـmerchant_id"
    );
    assert(
      seen.length === 3 && seen.every((s) => s.mid === "m_a"),
      "BULK-6: صفر تحديث بلا merchant_id — العزل على كل صف بالاعتماد الجماعي"
    );

    // BULK-7 — updatePayload: يدمج فوق الحمولة الحالية بشرط pending؛ غير المعلّق يُرفض ٤٠٤.
    const edited = await updatePayload({ DB: rqDb }, { merchantId: "m_a", id: 7, patch: { description: "جديد" } });
    const editedPayload = JSON.parse(edited.payload);
    assert(
      editedPayload.sku === "S1" && editedPayload.description === "جديد" && typeof editedPayload.editedAt === "string",
      "BULK-7: التحرير السطري يدمج الوصف الجديد فوق الحمولة ويحتفظ بالـSKU"
    );
    let notPending = null;
    try {
      await updatePayload({ DB: rqDb }, { merchantId: "m_a", id: 8, patch: { description: "x" } });
    } catch (e) {
      notPending = e;
    }
    assert(notPending?.status === 404 && notPending?.code === "REVIEW_NOT_PENDING", "BULK-8: تعديل عنصر غير معلّق يُرفض ٤٠٤ بلا كتابة");

    // BULK-9 — العدّادات الصادقة تفرّق "معتمد بانتظار النشر" عن "نُشر".
    const counts = await countByState({ DB: rqDb }, { merchantId: "m_a", kind: "description" });
    assert(
      counts.pending === 2 && counts.awaitingPublish === 1 && counts.published === 3 && counts.rejected === 1,
      "BULK-9: countByState يعيد معلّق/بانتظار النشر/نُشر/مرفوض منفصلة"
    );
    let badState = null;
    try {
      await listByState({ DB: rqDb }, { merchantId: "m_a", kind: "description", state: "1=1 OR" });
    } catch (e) {
      badState = e;
    }
    assert(badState?.status === 400, "BULK-10: حالة غير معروفة تُرفض ٤٠٠ — لا تركيب SQL من مدخل عميل");

    // BULK-11 — التراجع: الأصل يُكتب مرة واحدة ولا يمحوه السحب.
    const catalogSrc = read("../../functions/_lib/domain/catalog.js");
    assert(
      /original_description = COALESCE\(store_products\.original_description, excluded\.current_description\)/.test(catalogSrc),
      "BULK-11: سحب الكتالوج يحفظ original_description مرة واحدة (COALESCE) — التراجع ممكن بعد نشر هالة"
    );
    const migration = read("../../migrations/0022_catalog_original_description.sql");
    assert(/ADD COLUMN original_description/.test(migration) && /ADD COLUMN hala_published_at/.test(migration), "BULK-12: هجرة 0022 تضيف original_description وhala_published_at");

    // BULK-13 — التراجع يرفض ما لم تنشره هالة، ويُرجع الأصل حتى لو كان فارغاً (بلا اختراع نص).
    const decideSrc = read("../../functions/api/store/review/decide.js");
    const revertSrc = read("../../functions/_lib/domain/publish.js"); // المرحلة ٤: revert بالمجال
    assert(
      /NOTHING_TO_REVERT/.test(revertSrc) && /NOT_IN_CATALOG/.test(revertSrc) && /item\.original_description \|\| ""/.test(revertSrc) && /markReverted/.test(revertSrc),
      "BULK-13: revert مقيّد بما نشرته هالة، ويُرجع الأصل كما هو (حتى الفارغ)"
    );
    assert(
      /requireCompletedAccount\(request, env, body\.storeId\)/.test(decideSrc) && /reviewedBy = `merchant:\$\{merchantId\}`/.test(decideSrc),
      "BULK-14: قرارات التاجر بهوية الجلسة (reviewed_by من الجلسة لا من الجسم)"
    );

    // BULK-15 — الحصة الصادقة: أولوية + تأجيل بدل رفض + إحياء شهري.
    const genSrc = read("../../functions/api/store/bulk/generate.js");
    assert(
      /listPriorityCatalog/.test(genSrc) && /markDeferredItems/.test(genSrc) && /باقتك تغطي/.test(genSrc)
        && /DEFERRED_MARKER/.test(read("../../functions/_lib/domain/bulk.js")),
      "BULK-15: التوليد من الكتالوج بأولوية SEO، وما فوق الحصة مؤجَّل بنص صادق"
    );
    assert(/tickReviveDeferred/.test(cron) && /reviveDeferredItems/.test(cron), "BULK-16: الـcron يُحيي المؤجَّل عند تجدّد الحصة بلا فعل من التاجر");
    assert(
      /ORDER BY \(hala_published_at IS NOT NULL\) ASC,\s*\(COALESCE\(LENGTH\(current_description\), 0\) = 0\) DESC/.test(catalogSrc),
      "BULK-17: أولوية الحصة — بلا وصف أولاً، ثم القصير، وما نشرته هالة آخراً"
    );

    // BULK-18 — الداشبورد: لا وعد بنشر تلقائي؛ زر توليد من الكتالوج وشاشة مراجعة.
    const dash = await readComposedPage("dashboard");
    assert(
      !/ينشره على سلة تلقائياً/.test(dash) && /لا يُنشر شيء على سلة قبل ما تراجعه وتعتمده/.test(dash) && /\/api\/store\/review\/decide/.test(dash) && /\/api\/store\/bulk\/generate/.test(dash),
      "BULK-18: الداشبورد يعد بالمراجعة لا بالنشر التلقائي، ويصل شاشة المراجعة والتوليد من الكتالوج"
    );
  }
}

main()
  .then(() => done())
  .catch((e) => {
    console.error("❌ Tests threw an exception:");
    console.error(e);
    process.exit(1);
  });

  // ── اعتماد/رفض لكل منتج على حدة بالمراجعة الجماعية (2026-09-10) ──────
  {
    const { readFileSync } = await import("node:fs");
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const rev = read("../../public/js/dashboard/review.js");

    assert(
      /export async function decideOne\(id, action\)/.test(rev) &&
        /decideOne\(\$\{r\.id\}, 'approve'\)/.test(rev) && /decideOne\(\$\{r\.id\}, 'reject'\)/.test(rev),
      "ONE-1: كل بطاقة فيها اعتماد ورفض مستقلان"
    );
    // نفس نقطة القرار — لا مسار نشر ثانٍ يتجاوز بوابة المراجعة.
    assert(
      /postReviewDecide\(\{ action, ids: \[id\] \}\)/.test(rev) &&
        !/fetch\("\/api\/store\/publish"/.test(rev),
      "ONE-2: القرار المفرد يمرّ بنفس نقطة المراجعة لا بنشر مباشر"
    );
    // التعديل يُحفظ قبل الاعتماد وإلا نُشر النص الأصلي بدل ما كتبه التاجر.
    assert(
      /action: "edit", ids: \[id\], description: ta\.value/.test(rev),
      "ONE-3: تعديل التاجر يُحفظ قبل الاعتماد المفرد"
    );
    assert(
      /buttons\.forEach\(\(b\) => \{ b\.disabled = true; \}\)/.test(rev),
      "ONE-4: الأزرار تُقفل أثناء التنفيذ — لا نشر مزدوج بضغطتين"
    );
    assert(
      /decideOne/.test(read("../../public/js/dashboard/main.js")),
      "ONE-5: الدالة منشورة على window لسمات onclick"
    );
    // الأزرار الجماعية باقية.
    assert(
      /decideReview\('approve_all'\)/.test(read("../../partials/dashboard-review.html")),
      "ONE-6: الاعتماد الجماعي لم يُحذف — المساران متاحان"
    );
  }
