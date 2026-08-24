import {
  productContentExportStageInputSchema,
  productContentImportInputSchema,
  productContentManualDraftInputSchema,
  productContentDraftReviewInputSchema,
  productFactEvidenceApprovalInputSchema
} from "@hala/contracts";
import { Hono } from "hono";
import { ProductContentRepository } from "../../adapters/d1/product-content-repository";
import { ProductContentDraftReviewService } from "../../modules/product-content/product-content-draft-review-service";
import { ProductContentExportStageService } from "../../modules/product-content/product-content-export-stage-service";
import { renderApprovedProductDraftPreviewCsv } from "../../modules/product-content/product-content-preview-csv";
import { ProductContentDraftService } from "../../modules/product-content/product-content-draft-service";
import { ProductContentImportService } from "../../modules/product-content/product-content-import-service";
import { ProductContentReviewService } from "../../modules/product-content/product-content-review-service";
import { canMutateProductContent, canStageProductContentExport } from "../commercial-authorization";
import { resolveCurrentSession } from "../current-session";
import { errorResponse } from "../errors";
import { hasTrustedSameOrigin } from "../request-origin";
import type { HalaEnv } from "../types";

async function readJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function createProductContentRoutes(): Hono<HalaEnv> {
  const productContent = new Hono<HalaEnv>();

  productContent.post("/imports", async (context) => {
    if (!hasTrustedSameOrigin(context.req.raw)) {
      return errorResponse(
        context,
        403,
        "invalid_request_origin",
        "تعذر التحقق من مصدر الطلب بشكل آمن."
      );
    }

    const identity = await resolveCurrentSession(context);
    if (identity === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }

    if (!canMutateProductContent(identity.role)) {
      return errorResponse(context, 403, "forbidden", "صلاحيتك لا تسمح بتغيير محتوى المنتجات.");
    }

    const payload = await readJsonBody(context.req.raw);
    const parsed = productContentImportInputSchema.safeParse(payload);
    if (!parsed.success) {
      return errorResponse(
        context,
        400,
        "invalid_product_import",
        "تحقق من اسم الملف ومحتوى CSV قبل الرفع."
      );
    }

    const service = new ProductContentImportService(new ProductContentRepository(context.env.DB));
    const outcome = await service.submit({
      organizationId: identity.organizationId,
      userId: identity.userId,
      sourceName: parsed.data.sourceName,
      csvText: parsed.data.csvText
    });

    if (outcome.kind === "rejected") {
      return context.json(
        {
          status: "rejected",
          recordCount: outcome.recordCount,
          errors: outcome.errors,
          warnings: outcome.warnings
        },
        422
      );
    }

    return context.json(
      {
        status: outcome.status,
        importId: outcome.importId,
        recordCount: outcome.recordCount,
        warnings: outcome.warnings
      },
      201
    );
  });

  productContent.get("/review-items", async (context) => {
    const identity = await resolveCurrentSession(context);
    if (identity === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }

    const items = await new ProductContentRepository(context.env.DB).listEvidenceReviewItems(
      identity.organizationId
    );
    return context.json({ items });
  });

  productContent.get("/approved-facts", async (context) => {
    const identity = await resolveCurrentSession(context);
    if (identity === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }

    const facts = await new ProductContentRepository(context.env.DB).listApprovedFacts(
      identity.organizationId
    );
    return context.json({ facts });
  });

  productContent.get("/previews", async (context) => {
    const identity = await resolveCurrentSession(context);
    if (identity === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }

    const items = await new ProductContentRepository(context.env.DB).listPreviewItems(
      identity.organizationId
    );
    return context.json({ items });
  });

  productContent.post("/export-stages", async (context) => {
    if (!hasTrustedSameOrigin(context.req.raw)) {
      return errorResponse(
        context,
        403,
        "invalid_request_origin",
        "تعذر التحقق من مصدر الطلب بشكل آمن."
      );
    }

    const identity = await resolveCurrentSession(context);
    if (identity === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }
    if (!canStageProductContentExport(identity.role)) {
      return errorResponse(
        context,
        403,
        "forbidden",
        "تجهيز التصدير الداخلي متاح لمالك المساحة فقط."
      );
    }

    const parsed = productContentExportStageInputSchema.safeParse(
      await readJsonBody(context.req.raw)
    );
    if (!parsed.success) {
      return errorResponse(
        context,
        400,
        "invalid_product_export_stage",
        "أكد تجهيز مسودات معتمدة وفريدة قبل المتابعة."
      );
    }

    const outcome = await new ProductContentExportStageService(
      new ProductContentRepository(context.env.DB)
    ).stage({
      organizationId: identity.organizationId,
      userId: identity.userId,
      requestId: context.get("requestId"),
      draftIds: parsed.data.draftIds
    });
    if (outcome.kind === "drafts_not_available") {
      return errorResponse(
        context,
        409,
        "drafts_not_available_for_export_stage",
        "بعض المسودات لم تعد معتمدة ضمن هذه المساحة؛ حدث المعاينة ثم أعد المراجعة."
      );
    }

    return context.json(
      {
        status: "staged",
        exportStageId: outcome.exportStageId,
        itemCount: outcome.itemCount,
        scope: "internal_csv_review_only"
      },
      201
    );
  });

  productContent.get("/previews.csv", async (context) => {
    const identity = await resolveCurrentSession(context);
    if (identity === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }

    const items = await new ProductContentRepository(context.env.DB).listPreviewItems(
      identity.organizationId
    );
    return new Response(renderApprovedProductDraftPreviewCsv(items), {
      headers: {
        "content-disposition": "attachment; filename=hala-approved-drafts-preview.csv",
        "content-type": "text/csv; charset=utf-8",
        "x-content-type-options": "nosniff"
      }
    });
  });

  productContent.get("/draft-review-items", async (context) => {
    const identity = await resolveCurrentSession(context);
    if (identity === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }

    const items = await new ProductContentRepository(context.env.DB).listDraftReviewItems(
      identity.organizationId
    );
    return context.json({ items });
  });

  productContent.post("/drafts/:draftId/review", async (context) => {
    if (!hasTrustedSameOrigin(context.req.raw)) {
      return errorResponse(
        context,
        403,
        "invalid_request_origin",
        "تعذر التحقق من مصدر الطلب بشكل آمن."
      );
    }

    const identity = await resolveCurrentSession(context);
    if (identity === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }
    if (!canMutateProductContent(identity.role)) {
      return errorResponse(context, 403, "forbidden", "صلاحيتك لا تسمح بمراجعة المسودة.");
    }

    const parsed = productContentDraftReviewInputSchema.safeParse(
      await readJsonBody(context.req.raw)
    );
    if (!parsed.success) {
      return errorResponse(
        context,
        400,
        "invalid_draft_review",
        "تحقق من قرار المراجعة والملاحظة."
      );
    }
    const outcome = await new ProductContentDraftReviewService(
      new ProductContentRepository(context.env.DB)
    ).review({
      organizationId: identity.organizationId,
      userId: identity.userId,
      requestId: context.get("requestId"),
      draftId: context.req.param("draftId"),
      review: parsed.data
    });
    if (outcome.kind === "not_available") {
      return errorResponse(
        context,
        404,
        "draft_not_available",
        "لا تتوفر مسودة جاهزة للمراجعة ضمن هذه المساحة."
      );
    }

    return context.json({ status: "reviewed" });
  });

  productContent.post("/drafts/manual", async (context) => {
    if (!hasTrustedSameOrigin(context.req.raw)) {
      return errorResponse(
        context,
        403,
        "invalid_request_origin",
        "تعذر التحقق من مصدر الطلب بشكل آمن."
      );
    }

    const identity = await resolveCurrentSession(context);
    if (identity === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }
    if (!canMutateProductContent(identity.role)) {
      return errorResponse(context, 403, "forbidden", "صلاحيتك لا تسمح بإنشاء مسودة محتوى.");
    }

    const payload = await readJsonBody(context.req.raw);
    const parsed = productContentManualDraftInputSchema.safeParse(payload);
    if (!parsed.success) {
      return errorResponse(
        context,
        400,
        "invalid_product_draft",
        "تحقق من حقول المسودة وخريطة الأدلة."
      );
    }

    const outcome = await new ProductContentDraftService(
      new ProductContentRepository(context.env.DB)
    ).submit({
      organizationId: identity.organizationId,
      userId: identity.userId,
      requestId: context.get("requestId"),
      draft: parsed.data
    });
    if (outcome.kind === "fact_not_available") {
      return errorResponse(
        context,
        404,
        "fact_not_available",
        "لا تتوفر fact معتمدة ضمن هذه المساحة لإنشاء المسودة."
      );
    }

    return context.json({ status: outcome.status, reasons: outcome.reasons }, 201);
  });

  productContent.post("/facts/:factId/approve-evidence", async (context) => {
    if (!hasTrustedSameOrigin(context.req.raw)) {
      return errorResponse(
        context,
        403,
        "invalid_request_origin",
        "تعذر التحقق من مصدر الطلب بشكل آمن."
      );
    }

    const identity = await resolveCurrentSession(context);
    if (identity === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }

    if (!canMutateProductContent(identity.role)) {
      return errorResponse(context, 403, "forbidden", "صلاحيتك لا تسمح باعتماد الأدلة.");
    }

    const payload = await readJsonBody(context.req.raw);
    const parsed = productFactEvidenceApprovalInputSchema.safeParse(payload);
    if (!parsed.success) {
      return errorResponse(
        context,
        400,
        "invalid_evidence_review",
        "تحقق من ملاحظة المراجعة قبل الاعتماد."
      );
    }

    const outcome = await new ProductContentReviewService(
      new ProductContentRepository(context.env.DB)
    ).approveEvidence({
      factId: context.req.param("factId"),
      organizationId: identity.organizationId,
      userId: identity.userId,
      reviewNote: parsed.data.reviewNote,
      requestId: context.get("requestId")
    });
    if (outcome.kind === "not_found") {
      return errorResponse(
        context,
        404,
        "not_found",
        "السجل المطلوب غير موجود أو لم يعد بانتظار المراجعة."
      );
    }

    return context.json({ status: "approved" });
  });

  return productContent;
}
