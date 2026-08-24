import type { ProductContentDraftStatus, ProductContentManualDraftInput } from "@hala/contracts";

export type DraftQualityReasonCode =
  | "invalid_fact_json"
  | "evidence_fact_key_missing"
  | "evidence_claim_not_found"
  | "unsupported_claim_language";

export type DraftQualityOutcome = Readonly<{
  status: Extract<ProductContentDraftStatus, "needs_revision" | "ready_for_review">;
  reasons: readonly DraftQualityReasonCode[];
}>;

const unsupportedClaimPatterns = [
  /يشفي/u,
  /علاج/u,
  /مضمون/u,
  /الأفضل/u,
  /نتائج مضمونة/u,
  /فعالية مثبتة/u
] as const;

function parseFactKeys(factsJson: string): readonly string[] | null {
  try {
    const parsed: unknown = JSON.parse(factsJson);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return Object.freeze(Object.keys(parsed));
  } catch {
    return null;
  }
}

function allDraftText(input: ProductContentManualDraftInput): string {
  return [input.title, input.shortDescription, input.longDescription, input.metaDescription].join(
    "\n"
  );
}

export function evaluateManualDraftQuality(
  input: ProductContentManualDraftInput,
  factsJson: string
): DraftQualityOutcome {
  const factKeys = parseFactKeys(factsJson);
  if (factKeys === null) {
    return Object.freeze({
      status: "needs_revision",
      reasons: Object.freeze(["invalid_fact_json"] as const)
    });
  }

  const text = allDraftText(input);
  const reasons = new Set<DraftQualityReasonCode>();
  for (const evidence of input.evidence) {
    if (!factKeys.includes(evidence.factKey)) {
      reasons.add("evidence_fact_key_missing");
    }
    if (!text.includes(evidence.claim)) {
      reasons.add("evidence_claim_not_found");
    }
  }
  if (unsupportedClaimPatterns.some((pattern) => pattern.test(text))) {
    reasons.add("unsupported_claim_language");
  }

  return reasons.size === 0
    ? Object.freeze({ status: "ready_for_review", reasons: Object.freeze([]) })
    : Object.freeze({ status: "needs_revision", reasons: Object.freeze([...reasons]) });
}
