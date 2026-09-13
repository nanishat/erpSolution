import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { importBankStatement } from "@/modules/bank-reconciliation/services/bank-reconciliation.service";
import { csvBankStatementImportErrorResponse } from "@/modules/bank-reconciliation/utils/bank-statement-csv-import-error-response";
import {
  MAX_CSV_FILE_SIZE_BYTES,
  parseBankStatementCsv,
  type CsvColumnMapping,
} from "@/modules/bank-reconciliation/utils/bank-statement-csv-parser";
import { importBankStatementSchema } from "@/modules/bank-reconciliation/validations/bank-reconciliation.schema";

// multipart/form-data variant of POST /api/bank-reconciliation/statements —
// parses an uploaded CSV into the same { date, description, amount,
// referenceNo }[] shape the JSON route already accepts, then hands off to
// the exact same importBankStatementSchema + importBankStatement pipeline.
// No balance/isReconcilable/amount-sign validation is duplicated here.
//
// A `dryRun` form field ("true") stops right after a successful parse and
// returns the parsed lines without ever calling importBankStatement — the
// import UI's preview step uses this to show the user what will be
// imported (and let them eyeball the balance) before anything is written.
// A dry run does not require accountId/period/balance fields at all, since
// those play no part in CSV parsing itself; the real commit call below is
// still the only place importBankStatementSchema/importBankStatement (and
// therefore the balance-tolerance check) ever run.
export async function POST(request: NextRequest) {
  const formData = await request.formData();

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A CSV file is required (form field 'file')" }, { status: 400 });
  }
  if (file.size > MAX_CSV_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `CSV file (${file.size} bytes) exceeds the ${MAX_CSV_FILE_SIZE_BYTES} byte limit` },
      { status: 413 }
    );
  }

  let columnMapping: CsvColumnMapping | undefined;
  const columnMappingRaw = formData.get("columnMapping");
  if (typeof columnMappingRaw === "string" && columnMappingRaw.trim() !== "") {
    try {
      columnMapping = JSON.parse(columnMappingRaw) as CsvColumnMapping;
    } catch {
      return NextResponse.json({ error: "columnMapping must be valid JSON" }, { status: 400 });
    }
  }

  try {
    const csvText = await file.text();
    const result = parseBankStatementCsv(csvText, { columnMapping });

    if (result.status === "needs_mapping") {
      return NextResponse.json(
        {
          error: `Could not auto-detect CSV columns: ${result.reason}`,
          needsColumnMapping: true,
          headers: result.headers,
          detected: result.detected,
          sampleRows: result.sampleRows,
        },
        { status: 422 }
      );
    }

    if (formData.get("dryRun") === "true") {
      return NextResponse.json({ data: { lines: result.lines } }, { status: 200 });
    }

    const body = {
      accountId: formData.get("accountId"),
      periodStart: formData.get("periodStart"),
      periodEnd: formData.get("periodEnd"),
      openingBalance: formData.get("openingBalance"),
      closingBalance: formData.get("closingBalance"),
      importedById: formData.get("importedById") ?? undefined,
      lines: result.lines,
    };

    const parsed = importBankStatementSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        { status: 400 }
      );
    }

    const statement = await importBankStatement(parsed.data);
    return NextResponse.json({ data: statement }, { status: 201 });
  } catch (error) {
    return csvBankStatementImportErrorResponse(error);
  }
}
