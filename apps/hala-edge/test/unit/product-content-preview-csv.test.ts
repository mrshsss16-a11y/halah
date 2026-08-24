import { describe, expect, it } from "vitest";
import { renderApprovedProductDraftPreviewCsv } from "../../src/modules/product-content/product-content-preview-csv";

describe("renderApprovedProductDraftPreviewCsv", () => {
  it("renders the approved preview projection with a UTF-8 BOM and escaped cells", () => {
    const csv = renderApprovedProductDraftPreviewCsv([
      {
        id: "draft-1",
        sku: "SKU-1",
        productReference: "product-1",
        title: 'عباية "سوداء"',
        shortDescription: "وصف قصير، واضح",
        longDescription: "سطر أول\nسطر ثانٍ",
        metaDescription: "وصف ميتا",
        evidenceMapJson: '{"version":1}'
      }
    ]);

    expect(csv).toBe(
      '\uFEFFsku,product_reference,title_ar,short_description_ar,long_description_ar,meta_description_ar,evidence_map_json\n"SKU-1","product-1","عباية ""سوداء""","وصف قصير، واضح","سطر أول\nسطر ثانٍ","وصف ميتا","{""version"":1}"\n'
    );
  });

  it("renders a header-only file when no draft is approved for preview", () => {
    expect(renderApprovedProductDraftPreviewCsv([])).toBe(
      "\uFEFFsku,product_reference,title_ar,short_description_ar,long_description_ar,meta_description_ar,evidence_map_json\n\n"
    );
  });
});
