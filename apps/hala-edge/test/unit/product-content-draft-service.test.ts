import { describe, expect, it } from "vitest";
import type {
  ApprovedProductFact,
  CreateProductContentDraft,
  ProductContentDraftRepositoryPort
} from "../../src/modules/product-content/product-content-draft-port";
import { ProductContentDraftService } from "../../src/modules/product-content/product-content-draft-service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const factId = "33333333-3333-4333-8333-333333333333";

const draft = {
  factId,
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

class FakeProductContentDraftRepository implements ProductContentDraftRepositoryPort {
  public fact: ApprovedProductFact | null = Object.freeze({
    id: factId,
    factsJson: JSON.stringify({
      productNameAr: "عباية سوداء",
      sourceUrl: "https://merchant.example.test/products/abaya-1"
    })
  });
  public drafts: CreateProductContentDraft[] = [];

  public async listApprovedFacts(): Promise<readonly []> {
    return Object.freeze([]);
  }

  public async findApprovedFact(): Promise<ApprovedProductFact | null> {
    return this.fact;
  }

  public async createDraft(input: CreateProductContentDraft): Promise<void> {
    this.drafts.push(input);
  }
}

describe("ProductContentDraftService", () => {
  it("stores a ready-for-review draft only from an approved fact", async () => {
    const repository = new FakeProductContentDraftRepository();
    const service = new ProductContentDraftService(
      repository,
      () => new Date("2026-08-24T00:00:00.000Z"),
      (() => {
        let sequence = 0;
        return () => `id-${++sequence}`;
      })()
    );

    await expect(
      service.submit({ organizationId, userId, requestId: "request-1", draft })
    ).resolves.toEqual({ kind: "stored", status: "ready_for_review", reasons: [] });
    expect(repository.drafts).toHaveLength(1);
    expect(repository.drafts[0]).toEqual(
      expect.objectContaining({
        organizationId,
        productFactSetId: factId,
        status: "ready_for_review",
        createdByUserId: userId,
        requestId: "request-1"
      })
    );
  });

  it("does not store a draft when the fact is not approved in this organization", async () => {
    const repository = new FakeProductContentDraftRepository();
    repository.fact = null;
    const service = new ProductContentDraftService(repository);

    await expect(
      service.submit({ organizationId, userId, requestId: "request-1", draft })
    ).resolves.toEqual({ kind: "fact_not_available" });
    expect(repository.drafts).toHaveLength(0);
  });
});
