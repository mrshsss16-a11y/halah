import { Hono } from "hono";
import { D1SallaWebhookInboxRepository } from "../../adapters/d1/salla-webhook-inbox-repository";
import { verifySallaWebhookSignature } from "../../adapters/salla/webhook";
import { SallaWebhookInboxService } from "../../modules/salla/salla-webhook-inbox-service";
import { errorResponse } from "../errors";
import type { HalaEnv } from "../types";

type LocalSallaWebhookEnvelope = Readonly<{
  event_id?: unknown;
  event_type?: unknown;
  organization_id?: unknown;
}>;

function readEnvelopeText(
  envelope: LocalSallaWebhookEnvelope,
  key: keyof LocalSallaWebhookEnvelope
): string | null {
  const value = envelope[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseLocalEnvelope(rawBody: Uint8Array): LocalSallaWebhookEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(rawBody));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as LocalSallaWebhookEnvelope)
      : null;
  } catch {
    return null;
  }
}

export function createSallaWebhookRoutes(): Hono<HalaEnv> {
  const sallaWebhook = new Hono<HalaEnv>();

  sallaWebhook.post("/", async (context) => {
    const config = context.get("config");
    if (config.environment !== "development") {
      return errorResponse(
        context,
        503,
        "salla_webhook_not_configured",
        "استقبال سلة غير مفعّل في هذه البيئة."
      );
    }

    const webhookSecret = context.env.SALLA_WEBHOOK_SECRET;
    if (webhookSecret === undefined || webhookSecret.trim().length === 0) {
      return errorResponse(
        context,
        503,
        "salla_webhook_not_configured",
        "استقبال سلة غير مهيأ محلياً."
      );
    }

    const rawBody = new Uint8Array(await context.req.arrayBuffer());
    const verification = await verifySallaWebhookSignature({
      rawBody,
      headers: context.req.raw.headers,
      webhookSecret
    });
    if (verification.kind !== "valid") {
      return errorResponse(context, 401, "invalid_webhook_signature", "تعذر التحقق من مصدر الحدث.");
    }

    const envelope = parseLocalEnvelope(rawBody);
    const organizationId = envelope === null ? null : readEnvelopeText(envelope, "organization_id");
    const externalEventId = envelope === null ? null : readEnvelopeText(envelope, "event_id");
    const eventType = envelope === null ? null : readEnvelopeText(envelope, "event_type");
    if (organizationId === null || externalEventId === null || eventType === null) {
      return errorResponse(
        context,
        400,
        "invalid_webhook_event",
        "بيانات الحدث المحلي غير مكتملة."
      );
    }

    const outcome = await new SallaWebhookInboxService(
      new D1SallaWebhookInboxRepository(context.env.DB)
    ).receive({
      organizationId,
      externalEventId,
      eventType,
      rawBody,
      requestId: context.get("requestId")
    });

    if (outcome.kind === "invalid_envelope") {
      return errorResponse(
        context,
        400,
        "invalid_webhook_event",
        "بيانات الحدث المحلي غير مكتملة."
      );
    }

    return context.json(
      {
        status: "accepted",
        requestId: context.get("requestId")
      },
      202
    );
  });

  return sallaWebhook;
}
