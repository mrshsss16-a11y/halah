import type { ProductContentImportStatus } from "@hala/contracts";

const requiredHeaders = [
  "product_ref",
  "sku",
  "product_name_ar",
  "category",
  "facts_json"
] as const;
const MAX_RECORDS_PER_IMPORT = 200;

type RequiredHeader = (typeof requiredHeaders)[number];

type CsvRow = Readonly<{
  line: number;
  values: Readonly<Record<string, string>>;
}>;

export type ProductImportIssueCode =
  | "csv_unclosed_quote"
  | "csv_missing_header"
  | "csv_duplicate_header"
  | "csv_column_count_mismatch"
  | "csv_no_records"
  | "csv_record_limit_exceeded"
  | "required_value_missing"
  | "duplicate_sku"
  | "sku_already_imported"
  | "facts_json_invalid"
  | "facts_json_empty"
  | "source_url_invalid"
  | "source_evidence_missing"
  | "source_evidence_pending_review";

export type ProductImportIssue = Readonly<{
  line: number;
  code: ProductImportIssueCode;
  field: string | null;
  message: string;
}>;

export type ValidatedProductFact = Readonly<{
  line: number;
  productReference: string;
  sku: string;
  category: string;
  factsJson: string;
  evidenceStatus: "approved" | "needs_evidence";
}>;

export type ProductCsvValidationResult = Readonly<{
  status: ProductContentImportStatus;
  recordCount: number;
  facts: readonly ValidatedProductFact[];
  errors: readonly ProductImportIssue[];
  warnings: readonly ProductImportIssue[];
}>;

type ParsedCsv =
  | Readonly<{ kind: "parsed"; rows: readonly (readonly string[])[] }>
  | Readonly<{ kind: "unclosed_quote" }>;

function parseCsv(csvText: string): ParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    if (character === undefined) {
      continue;
    }

    if (character === '"') {
      const nextCharacter = csvText[index + 1];
      if (inQuotes && nextCharacter === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && csvText[index + 1] === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += character;
  }

  if (inQuotes) {
    return Object.freeze({ kind: "unclosed_quote" });
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return Object.freeze({ kind: "parsed", rows });
}

function normalizeHeader(value: string, index: number): string {
  const withoutBom = index === 0 ? value.replace(/^\uFEFF/, "") : value;
  return withoutBom.trim();
}

function createIssue(
  line: number,
  code: ProductImportIssueCode,
  field: string | null,
  message: string
): ProductImportIssue {
  return Object.freeze({ line, code, field, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isApprovedSourceUrl(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function readRequiredValue(
  row: CsvRow,
  header: RequiredHeader,
  errors: ProductImportIssue[]
): string | null {
  const value = row.values[header];
  if (value === undefined || value.trim().length === 0) {
    errors.push(
      createIssue(row.line, "required_value_missing", header, "الحقل مطلوب قبل إنشاء أي مسودة.")
    );
    return null;
  }

  return value.trim();
}

function toCsvRows(rows: readonly (readonly string[])[]): CsvRow[] {
  const headerRow = rows[0];
  if (headerRow === undefined) {
    return [];
  }

  const headers = headerRow.map(normalizeHeader);
  const csvRows: CsvRow[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const values = rows[index];
    if (values === undefined || values.every((value) => value.trim().length === 0)) {
      continue;
    }

    const record: Record<string, string> = {};
    for (let cellIndex = 0; cellIndex < headers.length; cellIndex += 1) {
      const header = headers[cellIndex];
      const value = values[cellIndex];
      if (header !== undefined && value !== undefined) {
        record[header] = value;
      }
    }

    csvRows.push(Object.freeze({ line: index + 1, values: Object.freeze(record) }));
  }

  return csvRows;
}

export function validateProductCsv(csvText: string): ProductCsvValidationResult {
  const parsed = parseCsv(csvText);
  if (parsed.kind === "unclosed_quote") {
    return Object.freeze({
      status: "failed",
      recordCount: 0,
      facts: Object.freeze([]),
      errors: Object.freeze([
        createIssue(0, "csv_unclosed_quote", null, "يوجد اقتباس غير مغلق في ملف CSV.")
      ]),
      warnings: Object.freeze([])
    });
  }

  const headerRow = parsed.rows[0];
  if (headerRow === undefined) {
    return Object.freeze({
      status: "failed",
      recordCount: 0,
      facts: Object.freeze([]),
      errors: Object.freeze([
        createIssue(1, "csv_missing_header", null, "ملف CSV يحتاج سطر عناوين واضحاً.")
      ]),
      warnings: Object.freeze([])
    });
  }

  const headers = headerRow.map(normalizeHeader);
  const errors: ProductImportIssue[] = [];
  const warnings: ProductImportIssue[] = [];
  const headerSet = new Set<string>();
  for (const header of headers) {
    if (headerSet.has(header)) {
      errors.push(createIssue(1, "csv_duplicate_header", header, "عنوان العمود مكرر."));
    }
    headerSet.add(header);
  }

  for (const header of requiredHeaders) {
    if (!headerSet.has(header)) {
      errors.push(
        createIssue(1, "csv_missing_header", header, "العمود مطلوب لاستيراد facts بأمان.")
      );
    }
  }

  if (errors.length > 0) {
    return Object.freeze({
      status: "failed",
      recordCount: 0,
      facts: Object.freeze([]),
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings)
    });
  }

  const csvRows = toCsvRows(parsed.rows);
  if (csvRows.length === 0) {
    return Object.freeze({
      status: "failed",
      recordCount: 0,
      facts: Object.freeze([]),
      errors: Object.freeze([
        createIssue(1, "csv_no_records", null, "أضف صف منتج واحد على الأقل بعد العناوين.")
      ]),
      warnings: Object.freeze([])
    });
  }
  if (csvRows.length > MAX_RECORDS_PER_IMPORT) {
    return Object.freeze({
      status: "failed",
      recordCount: csvRows.length,
      facts: Object.freeze([]),
      errors: Object.freeze([
        createIssue(
          0,
          "csv_record_limit_exceeded",
          null,
          "قسم الدفعة إلى 200 SKU أو أقل حتى تراجعها هالة بأمان."
        )
      ]),
      warnings: Object.freeze([])
    });
  }

  const facts: ValidatedProductFact[] = [];
  const seenSkus = new Map<string, number>();

  for (const row of csvRows) {
    const originalValues = parsed.rows[row.line - 1];
    if (originalValues !== undefined && originalValues.length !== headers.length) {
      errors.push(
        createIssue(
          row.line,
          "csv_column_count_mismatch",
          null,
          "عدد أعمدة الصف لا يطابق العناوين."
        )
      );
      continue;
    }

    const productReference = readRequiredValue(row, "product_ref", errors);
    const sku = readRequiredValue(row, "sku", errors);
    const productName = readRequiredValue(row, "product_name_ar", errors);
    const category = readRequiredValue(row, "category", errors);
    const factsValue = readRequiredValue(row, "facts_json", errors);
    if (
      productReference === null ||
      sku === null ||
      productName === null ||
      category === null ||
      factsValue === null
    ) {
      continue;
    }

    const priorSkuLine = seenSkus.get(sku);
    if (priorSkuLine !== undefined) {
      errors.push(
        createIssue(
          row.line,
          "duplicate_sku",
          "sku",
          `SKU مكرر؛ ظهر سابقاً في السطر ${priorSkuLine}.`
        )
      );
      continue;
    }
    seenSkus.set(sku, row.line);

    let parsedFacts: unknown;
    try {
      parsedFacts = JSON.parse(factsValue);
    } catch {
      errors.push(
        createIssue(
          row.line,
          "facts_json_invalid",
          "facts_json",
          "صيغة facts_json ليست JSON صالحاً."
        )
      );
      continue;
    }

    if (!isRecord(parsedFacts)) {
      errors.push(
        createIssue(
          row.line,
          "facts_json_invalid",
          "facts_json",
          "facts_json يجب أن يكون كائناً منظماً."
        )
      );
      continue;
    }
    if (Object.keys(parsedFacts).length === 0) {
      errors.push(
        createIssue(
          row.line,
          "facts_json_empty",
          "facts_json",
          "facts_json لا يمكن أن يكون فارغاً."
        )
      );
      continue;
    }

    const sourceUrl = row.values["source_url"]?.trim() ?? "";
    const evidenceStatus: "approved" | "needs_evidence" = "needs_evidence";
    if (sourceUrl.length === 0) {
      warnings.push(
        createIssue(
          row.line,
          "source_evidence_missing",
          "source_url",
          "أضف رابط مصدر أو دليل معتمد قبل التوليد."
        )
      );
    } else if (!isApprovedSourceUrl(sourceUrl)) {
      warnings.push(
        createIssue(
          row.line,
          "source_url_invalid",
          "source_url",
          "رابط المصدر يجب أن يبدأ بـ https."
        )
      );
    } else {
      warnings.push(
        createIssue(
          row.line,
          "source_evidence_pending_review",
          "source_url",
          "رابط المصدر موجود، لكنه يحتاج مراجعة واعتماداً قبل التوليد."
        )
      );
    }

    const factsWithIdentity = Object.freeze({
      ...parsedFacts,
      productNameAr: productName,
      sourceUrl
    });
    facts.push(
      Object.freeze({
        line: row.line,
        productReference,
        sku,
        category,
        factsJson: JSON.stringify(factsWithIdentity),
        evidenceStatus
      })
    );
  }

  if (errors.length > 0) {
    return Object.freeze({
      status: "failed",
      recordCount: csvRows.length,
      facts: Object.freeze([]),
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings)
    });
  }

  const status: ProductContentImportStatus = "needs_evidence";
  return Object.freeze({
    status,
    recordCount: facts.length,
    facts: Object.freeze(facts),
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings)
  });
}
