import { describe, expect, it } from "vitest";
import { evaluateManualDraftQuality } from "../../src/modules/product-content/draft-quality";

const validDraft = {
  factId: "11111111-1111-4111-8111-111111111111",
  title: "عباية سوداء بتفاصيل ظاهرة",
  shortDescription: "عباية سوداء بمواصفات موثقة من بيانات المنتج، ومسودة تحتاج مراجعة قبل العرض.",
  longDescription:
    "تعرض هذه المسودة عباية سوداء وفق الحقائق المعتمدة في بيانات المنتج. راجع الملاءمة والأسلوب قبل اعتمادها للمعاينة، ولا تضف مواصفات غير موثقة.",
  metaDescription: "عباية سوداء بمواصفات موثقة من بيانات المنتج، جاهزة للمراجعة قبل المعاينة.",
  evidence: [
    { claim: "عباية سوداء", factKey: "productNameAr" },
    { claim: "بيانات المنتج", factKey: "sourceUrl" }
  ]
};

const factsJson = JSON.stringify({
  productNameAr: "عباية سوداء",
  color: "أسود",
  sourceUrl: "https://merchant.example.test/products/abaya-1"
});

describe("manual product draft quality", () => {
  it("moves a fully evidenced draft to review", () => {
    expect(evaluateManualDraftQuality(validDraft, factsJson)).toEqual({
      status: "ready_for_review",
      reasons: []
    });
  });

  it("requires revision when evidence points to a missing fact key", () => {
    expect(
      evaluateManualDraftQuality(
        {
          ...validDraft,
          evidence: [{ claim: "عباية سوداء", factKey: "material" }]
        },
        factsJson
      )
    ).toEqual({ status: "needs_revision", reasons: ["evidence_fact_key_missing"] });
  });

  it("requires revision when the claimed phrase is absent from draft text", () => {
    expect(
      evaluateManualDraftQuality(
        {
          ...validDraft,
          evidence: [{ claim: "مقاس واسع", factKey: "productNameAr" }]
        },
        factsJson
      )
    ).toEqual({ status: "needs_revision", reasons: ["evidence_claim_not_found"] });
  });

  it("blocks unsupported medical or guarantee language", () => {
    expect(
      evaluateManualDraftQuality(
        { ...validDraft, longDescription: `${validDraft.longDescription} نتائج مضمونة.` },
        factsJson
      )
    ).toEqual({ status: "needs_revision", reasons: ["unsupported_claim_language"] });
  });
});
