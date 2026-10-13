// CSV -> ImportBankStatementInput["lines"] converter. This module only
// parses raw CSV text into the same plain-line shape importBankStatement
// already accepts (date/description/amount/referenceNo) — it duplicates
// none of that function's own validation (balance check, isReconcilable
// gating, amount !== 0). The caller (the import-csv route) still runs the
// result through importBankStatementSchema + importBankStatement unchanged.

// Bank exports are not standardized, so columns are detected by header name
// rather than position. Kept as an exact-match list against a normalized
// header (lowercased, punctuation collapsed to spaces) rather than substring
// matching, to avoid false positives (e.g. a "Reference Date" column should
// not silently satisfy both "date" and "reference").
const DATE_HEADER_VARIANTS = new Set([
  "date",
  "transaction date",
  "txn date",
  "trans date",
  "posting date",
  "value date",
  "booking date",
  "entry date",
]);

const DESCRIPTION_HEADER_VARIANTS = new Set([
  "description",
  "narrative",
  "particulars",
  "details",
  "transaction details",
  "transaction description",
  "memo",
  "narration",
  "remarks",
]);

// A single signed amount column. Assumed already signed the same way
// BankStatementLine.amount is (+ inflow / - outflow) — there is no separate
// unsigned "amount" + "type" column convention handled by this basic pass.
const AMOUNT_HEADER_VARIANTS = new Set(["amount", "transaction amount", "net amount", "amount bdt", "txn amount"]);

// Debit = outflow = negative, Credit = inflow = positive. This mirrors the
// documented convention on BankStatementLine.amount in schema.prisma ("+
// inflow, - outflow") exactly, so a debit/credit statement lands on the same
// sign convention a single-amount statement already uses. Getting this
// backwards would silently invert every imported statement's balance, so it
// is deliberately spelled out here rather than left implicit.
const DEBIT_HEADER_VARIANTS = new Set(["debit", "withdrawal", "debit amount", "withdrawal amount", "paid out", "dr"]);
const CREDIT_HEADER_VARIANTS = new Set(["credit", "deposit", "credit amount", "deposit amount", "paid in", "cr"]);

const REFERENCE_HEADER_VARIANTS = new Set([
  "reference",
  "reference no",
  "reference number",
  "ref no",
  "ref",
  "cheque no",
  "check no",
  "transaction id",
  "txn id",
  "instrument no",
]);

// Sanity limits for this basic pass. Bank statements for a single
// reconciliation period are normally a few hundred lines; 5,000 data rows /
// 2MB comfortably covers even a multi-year statement pulled by mistake while
// keeping a single synchronous parse bounded. Enforced independently of any
// HTTP-layer size check so a direct caller of parseBankStatementCsv gets the
// same guarantee.
export const MAX_CSV_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
export const MAX_CSV_DATA_ROWS = 5000;

export class CsvFileTooLargeError extends Error {
  constructor(sizeBytes: number) {
    super(`CSV file (${sizeBytes} bytes) exceeds the ${MAX_CSV_FILE_SIZE_BYTES} byte limit`);
    this.name = "CsvFileTooLargeError";
  }
}

export class CsvTooManyRowsError extends Error {
  constructor(rowCount: number) {
    super(`CSV has ${rowCount} data rows, exceeding the ${MAX_CSV_DATA_ROWS} row limit`);
    this.name = "CsvTooManyRowsError";
  }
}

export class CsvEmptyError extends Error {
  constructor() {
    super("CSV file has no header row");
    this.name = "CsvEmptyError";
  }
}

export class CsvMalformedRowError extends Error {
  constructor(rowNumber: number, expectedColumns: number, actualColumns: number) {
    super(
      `Row ${rowNumber} has ${actualColumns} column(s), expected ${expectedColumns} (matching the header row) — file may use a different delimiter or have corrupted rows`
    );
    this.name = "CsvMalformedRowError";
  }
}

export class CsvRowParseError extends Error {
  constructor(rowNumber: number, field: string, rawValue: string) {
    super(`Row ${rowNumber}: could not parse "${rawValue}" as ${field}`);
    this.name = "CsvRowParseError";
  }
}

export class CsvColumnMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvColumnMappingError";
  }
}

export type CsvDateFormat = "ISO" | "DMY" | "MDY";

export type CsvColumnMapping = {
  date: string;
  description: string;
  amount?: string;
  debit?: string;
  credit?: string;
  referenceNo?: string;
  dateFormat?: CsvDateFormat;
};

export type ParsedBankStatementLine = {
  date: Date;
  description: string;
  amount: number;
  referenceNo?: string;
};

type DetectedColumns = {
  date?: string;
  description?: string;
  amount?: string;
  debit?: string;
  credit?: string;
  referenceNo?: string;
};

export type CsvParsePreview = {
  status: "needs_mapping";
  reason: string;
  headers: string[];
  detected: DetectedColumns;
  sampleRows: string[][];
  dateFormatRequired?: boolean;
};

export type CsvParseSuccess = {
  status: "ok";
  lines: ParsedBankStatementLine[];
};

export type CsvParseResult = CsvParsePreview | CsvParseSuccess;

function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Full-content tokenizer (not a per-line split) so a quoted field containing
// a literal newline is handled correctly, per RFC4180. Handles CRLF, LF, and
// lone-CR line endings and "" as an escaped quote inside a quoted field.
function tokenizeCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyContent = false;

  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      sawAnyContent = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      sawAnyContent = true;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") {
        i++;
      }
      row.push(field);
      field = "";
      // Skip fully blank lines (common trailing blank line at EOF) rather
      // than emitting a spurious empty row that would fail the
      // column-count sanity check below.
      if (row.length > 1 || row[0] !== "") {
        rows.push(row);
      }
      row = [];
      continue;
    }
    field += ch;
    sawAnyContent = true;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") {
      rows.push(row);
    }
  }

  if (!sawAnyContent && rows.length === 0) {
    return [];
  }
  return rows;
}

function detectColumns(headers: string[]): { detected: DetectedColumns; ambiguous: string[] } {
  const normalized = headers.map(normalizeHeader);
  const detected: DetectedColumns = {};
  const ambiguous: string[] = [];

  function pick(field: keyof DetectedColumns, variants: Set<string>) {
    const matches = headers.filter((_, i) => variants.has(normalized[i]));
    if (matches.length === 1) {
      detected[field] = matches[0];
    } else if (matches.length > 1) {
      ambiguous.push(field);
    }
  }

  pick("date", DATE_HEADER_VARIANTS);
  pick("description", DESCRIPTION_HEADER_VARIANTS);
  pick("amount", AMOUNT_HEADER_VARIANTS);
  pick("debit", DEBIT_HEADER_VARIANTS);
  pick("credit", CREDIT_HEADER_VARIANTS);
  pick("referenceNo", REFERENCE_HEADER_VARIANTS);

  return { detected, ambiguous };
}

function resolveMapping(headers: string[], columnMapping?: CsvColumnMapping): CsvParsePreview | CsvColumnMapping {
  if (columnMapping) {
    for (const [field, headerName] of Object.entries(columnMapping)) {
      if (field === "dateFormat") {
        if (headerName !== undefined && !["ISO", "DMY", "MDY"].includes(headerName)) {
          throw new CsvColumnMappingError("Date format must be ISO, DMY, or MDY");
        }
        continue;
      }
      if (headerName !== undefined && !headers.includes(headerName)) {
        throw new CsvColumnMappingError(`Mapped column "${headerName}" for "${field}" is not a header in this file`);
      }
    }
    if (!columnMapping.amount && !columnMapping.debit && !columnMapping.credit) {
      throw new CsvColumnMappingError("Column mapping must specify either 'amount' or 'debit'/'credit'");
    }
    return columnMapping;
  }

  const { detected, ambiguous } = detectColumns(headers);
  const missingRequired: string[] = [];
  if (!detected.date) missingRequired.push("date");
  if (!detected.description) missingRequired.push("description");
  const hasAmount = Boolean(detected.amount);
  const hasDebitOrCredit = Boolean(detected.debit || detected.credit);
  if (!hasAmount && !hasDebitOrCredit) missingRequired.push("amount (or debit/credit)");

  const bothAmountShapesPresent = hasAmount && hasDebitOrCredit;

  if (ambiguous.length > 0 || missingRequired.length > 0 || bothAmountShapesPresent) {
    const reasons: string[] = [];
    if (missingRequired.length > 0) reasons.push(`could not auto-detect: ${missingRequired.join(", ")}`);
    if (ambiguous.length > 0) reasons.push(`ambiguous (multiple matching columns): ${ambiguous.join(", ")}`);
    if (bothAmountShapesPresent) reasons.push("both a single amount column and debit/credit columns were detected");

    return {
      status: "needs_mapping",
      reason: reasons.join("; "),
      headers,
      detected,
      sampleRows: [],
    };
  }

  return {
    date: detected.date!,
    description: detected.description!,
    amount: detected.amount,
    debit: detected.debit,
    credit: detected.credit,
    referenceNo: detected.referenceNo,
  };
}

type NumericDateParts = {
  first: number;
  second: number;
  year: number;
};

function getNumericDateParts(raw: string): NumericDateParts | null {
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw.trim());
  if (!match) return null;
  return { first: Number(match[1]), second: Number(match[2]), year: Number(match[3]) };
}

function parseDateParts(year: number, month: number, day: number, raw: string, rowNumber: number): Date {
  const isoDate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== isoDate) {
    throw new CsvRowParseError(rowNumber, "date", raw);
  }
  return date;
}

function parseCsvDateWithFormat(raw: string, rowNumber: number, format: CsvDateFormat): Date {
  const trimmed = raw.trim();
  if (format === "ISO") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (!match) throw new CsvRowParseError(rowNumber, "date", raw);
    return parseDateParts(Number(match[1]), Number(match[2]), Number(match[3]), raw, rowNumber);
  }

  const parts = getNumericDateParts(trimmed);
  if (!parts) throw new CsvRowParseError(rowNumber, "date", raw);
  return format === "DMY"
    ? parseDateParts(parts.year, parts.second, parts.first, raw, rowNumber)
    : parseDateParts(parts.year, parts.first, parts.second, raw, rowNumber);
}

function detectDateFormat(
  dateValues: { value: string; rowNumber: number }[]
): { format?: CsvDateFormat; ambiguous: boolean } {
  let detectedFormat: "DMY" | "MDY" | undefined;
  let hasAmbiguousDate = false;

  for (const { value, rowNumber } of dateValues) {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      parseCsvDateWithFormat(trimmed, rowNumber, "ISO");
      continue;
    }

    const parts = getNumericDateParts(trimmed);
    if (!parts) {
      if (!trimmed || Number.isNaN(new Date(trimmed).getTime())) {
        throw new CsvRowParseError(rowNumber, "date", value);
      }
      continue;
    }

    if (parts.first < 1 || parts.second < 1 || (parts.first > 12 && parts.second > 12)) {
      throw new CsvRowParseError(rowNumber, "date", value);
    }
    const rowFormat =
      parts.first > 12 ? "DMY" : parts.second > 12 ? "MDY" : undefined;

    if (!rowFormat) {
      hasAmbiguousDate = true;
      continue;
    }
    if (detectedFormat && detectedFormat !== rowFormat) {
      throw new CsvRowParseError(rowNumber, "date", value);
    }
    detectedFormat = rowFormat;
    parseCsvDateWithFormat(trimmed, rowNumber, detectedFormat);
  }

  return {
    format: detectedFormat,
    ambiguous: !detectedFormat && hasAmbiguousDate,
  };
}

function parseCsvDate(raw: string, rowNumber: number, detectedFormat?: CsvDateFormat): Date {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return parseCsvDateWithFormat(trimmed, rowNumber, "ISO");
  }

  if (getNumericDateParts(trimmed)) {
    if (!detectedFormat) throw new CsvRowParseError(rowNumber, "date", raw);
    return parseCsvDateWithFormat(trimmed, rowNumber, detectedFormat);
  }

  const date = new Date(trimmed);
  if (!Number.isNaN(date.getTime())) return date;
  throw new CsvRowParseError(rowNumber, "date", raw);
}

function parseAmountString(raw: string, rowNumber: number, field: string): number {
  let cleaned = raw.trim();
  if (cleaned === "") return 0;

  let negative = false;
  if (/^\(.*\)$/.test(cleaned)) {
    negative = true;
    cleaned = cleaned.slice(1, -1);
  }
  // Strip currency symbols/codes and thousands separators, keep digits,
  // decimal point, and a leading sign.
  cleaned = cleaned.replace(/,/g, "").replace(/[^0-9.\-+]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "+") {
    throw new CsvRowParseError(rowNumber, field, raw);
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value)) {
    throw new CsvRowParseError(rowNumber, field, raw);
  }
  return negative ? -Math.abs(value) : value;
}

function getCell(row: string[], headers: string[], columnName: string): string {
  const index = headers.indexOf(columnName);
  return index === -1 ? "" : (row[index] ?? "");
}

export function parseBankStatementCsv(content: string, options?: { columnMapping?: CsvColumnMapping }): CsvParseResult {
  const sizeBytes = Buffer.byteLength(content, "utf8");
  if (sizeBytes > MAX_CSV_FILE_SIZE_BYTES) {
    throw new CsvFileTooLargeError(sizeBytes);
  }

  const rows = tokenizeCsv(content);
  if (rows.length === 0) {
    throw new CsvEmptyError();
  }

  const headers = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1);

  if (dataRows.length > MAX_CSV_DATA_ROWS) {
    throw new CsvTooManyRowsError(dataRows.length);
  }

  const mappingResult = resolveMapping(headers, options?.columnMapping);
  if ("status" in mappingResult) {
    const preview = { ...mappingResult, sampleRows: dataRows.slice(0, 5) };
    if (mappingResult.detected.date && dataRows.every((row) => row.length === headers.length)) {
      const dateDetection = detectDateFormat(
        dataRows.map((row, i) => ({
          value: getCell(row, headers, mappingResult.detected.date!),
          rowNumber: i + 2,
        }))
      );
      if (dateDetection.ambiguous) {
        return {
          ...preview,
          reason: `${preview.reason}; date format is ambiguous, choose ISO, DMY, or MDY`,
          dateFormatRequired: true,
        };
      }
    }
    return preview;
  }
  const mapping = mappingResult;

  const expectedColumns = headers.length;
  for (let i = 0; i < dataRows.length; i++) {
    if (dataRows[i].length !== expectedColumns) {
      throw new CsvMalformedRowError(i + 2, expectedColumns, dataRows[i].length);
    }
  }

  const dateValues = dataRows.map((row, i) => ({
    value: getCell(row, headers, mapping.date),
    rowNumber: i + 2,
  }));
  const dateDetection = mapping.dateFormat
    ? { format: mapping.dateFormat, ambiguous: false }
    : detectDateFormat(dateValues);
  if (dateDetection.ambiguous) {
    return {
      status: "needs_mapping",
      reason: "date format is ambiguous; choose ISO, DMY, or MDY",
      headers,
      detected: {
        date: mapping.date,
        description: mapping.description,
        amount: mapping.amount,
        debit: mapping.debit,
        credit: mapping.credit,
        referenceNo: mapping.referenceNo,
      },
      sampleRows: dataRows.slice(0, 5),
      dateFormatRequired: true,
    };
  }
  const detectedDateFormat = dateDetection.format;

  const lines: ParsedBankStatementLine[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const rowNumber = i + 2; // 1-indexed, +1 for the header row
    const row = dataRows[i];

    const dateRaw = getCell(row, headers, mapping.date);
    const description = getCell(row, headers, mapping.description).trim();
    if (!description) {
      throw new CsvRowParseError(rowNumber, "description", description);
    }

    let amount: number;
    if (mapping.amount) {
      amount = parseAmountString(getCell(row, headers, mapping.amount), rowNumber, "amount");
    } else {
      const debitRaw = mapping.debit ? getCell(row, headers, mapping.debit) : "";
      const creditRaw = mapping.credit ? getCell(row, headers, mapping.credit) : "";
      const debit = parseAmountString(debitRaw, rowNumber, "debit");
      const credit = parseAmountString(creditRaw, rowNumber, "credit");
      // Sign convention (see DEBIT_HEADER_VARIANTS comment above): debit ->
      // negative (outflow), credit -> positive (inflow). Math.abs first so a
      // source that already signs one of these columns negative doesn't
      // double-flip.
      amount = roundCurrency(Math.abs(credit) - Math.abs(debit));
    }

    const referenceNoRaw = mapping.referenceNo ? getCell(row, headers, mapping.referenceNo).trim() : "";

    lines.push({
      date: mapping.dateFormat
        ? parseCsvDateWithFormat(dateRaw, rowNumber, mapping.dateFormat)
        : parseCsvDate(dateRaw, rowNumber, detectedDateFormat),
      description,
      amount,
      referenceNo: referenceNoRaw || undefined,
    });
  }

  return { status: "ok", lines };
}
