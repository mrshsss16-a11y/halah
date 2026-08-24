import { describe, expect, it } from "vitest";
import { validateProductCsv } from "../../src/modules/product-content/csv-import";

const header = "product_ref,sku,product_name_ar,category,facts_json,source_url";

function row(
  input: Readonly<{ productReference: string; sku: string; sourceUrl: string }>
): string {
  return `${input.productReference},${input.sku},عطر اختبار,عطور,"{""volume_ml"":100}",${input.sourceUrl}`;
}

describe("product CSV import validation", () => {
  it("holds even an https-backed facts row for human evidence approval", () => {
    const result = validateProductCsv(
      `${header}\n${row({
        productReference: "product-1",
        sku: "SKU-1",
        sourceUrl: "https://merchant.example.test/products/product-1"
      })}`
    );

    expect(result.status).toBe("needs_evidence");
    expect(result.recordCount).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "source_evidence_pending_review", field: "source_url" })
    ]);
    expect(result.facts).toEqual([
      expect.objectContaining({
        productReference: "product-1",
        sku: "SKU-1",
        category: "عطور",
        evidenceStatus: "needs_evidence"
      })
    ]);
  });

  it("holds a valid row that lacks source evidence instead of allowing generation", () => {
    const result = validateProductCsv(
      `${header}\n${row({ productReference: "product-1", sku: "SKU-1", sourceUrl: "" })}`
    );

    expect(result.status).toBe("needs_evidence");
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "source_evidence_missing", field: "source_url" })
    ]);
    expect(result.facts[0]).toEqual(expect.objectContaining({ evidenceStatus: "needs_evidence" }));
  });

  it("fails an entire import with duplicated SKU values", () => {
    const result = validateProductCsv(
      `${header}\n${row({
        productReference: "product-1",
        sku: "SKU-1",
        sourceUrl: "https://merchant.example.test/products/one"
      })}\n${row({
        productReference: "product-2",
        sku: "SKU-1",
        sourceUrl: "https://merchant.example.test/products/two"
      })}`
    );

    expect(result.status).toBe("failed");
    expect(result.facts).toEqual([]);
    expect(result.errors).toEqual([expect.objectContaining({ code: "duplicate_sku", line: 3 })]);
  });

  it("fails a row whose structured facts cannot be parsed", () => {
    const result = validateProductCsv(
      `${header}\nproduct-1,SKU-1,عطر اختبار,عطور,"{not-json}",https://merchant.example.test/products/one`
    );

    expect(result.status).toBe("failed");
    expect(result.errors).toEqual([
      expect.objectContaining({ code: "facts_json_invalid", field: "facts_json" })
    ]);
  });

  it("fails safely when a quoted CSV value is not closed", () => {
    const result = validateProductCsv(`${header}\nproduct-1,SKU-1,"عطر اختبار`);

    expect(result.status).toBe("failed");
    expect(result.errors).toEqual([expect.objectContaining({ code: "csv_unclosed_quote" })]);
  });

  it("fails an import that has headers but no product rows", () => {
    const result = validateProductCsv(header);

    expect(result.status).toBe("failed");
    expect(result.errors).toEqual([expect.objectContaining({ code: "csv_no_records" })]);
  });

  it("caps a reviewable local import at 200 SKU", () => {
    const rows = Array.from({ length: 201 }, (_, index) =>
      row({
        productReference: `product-${index + 1}`,
        sku: `SKU-${index + 1}`,
        sourceUrl: `https://merchant.example.test/products/${index + 1}`
      })
    );
    const result = validateProductCsv(`${header}\n${rows.join("\n")}`);

    expect(result.status).toBe("failed");
    expect(result.recordCount).toBe(201);
    expect(result.errors).toEqual([expect.objectContaining({ code: "csv_record_limit_exceeded" })]);
  });
});
