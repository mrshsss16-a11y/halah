import type { ProductContentPreviewItem } from "./product-content-draft-review-port";

const headers = [
  "sku",
  "product_reference",
  "title_ar",
  "short_description_ar",
  "long_description_ar",
  "meta_description_ar",
  "evidence_map_json"
] as const;

function escapeCsvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function renderApprovedProductDraftPreviewCsv(
  items: readonly ProductContentPreviewItem[]
): string {
  const rows = items.map((item) =>
    [
      item.sku,
      item.productReference,
      item.title,
      item.shortDescription,
      item.longDescription,
      item.metaDescription,
      item.evidenceMapJson
    ]
      .map(escapeCsvCell)
      .join(",")
  );

  return `\uFEFF${headers.join(",")}\n${rows.join("\n")}\n`;
}
