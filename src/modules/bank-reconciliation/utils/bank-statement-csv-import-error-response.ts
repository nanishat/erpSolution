import { NextResponse } from "next/server";

import {
  CsvColumnMappingError,
  CsvEmptyError,
  CsvFileTooLargeError,
  CsvMalformedRowError,
  CsvRowParseError,
  CsvTooManyRowsError,
} from "@/modules/bank-reconciliation/utils/bank-statement-csv-parser";
import { bankReconciliationErrorResponse } from "@/modules/bank-reconciliation/utils/bank-reconciliation-error-response";

// CSV-specific errors first; anything else (ReconciliationAccountNotFoundError,
// BankStatementBalanceMismatchError, ...) falls through to the existing
// bankReconciliationErrorResponse mapper unchanged — this route reuses
// importBankStatement's own validation rather than re-deciding status codes
// for it here.
export function csvBankStatementImportErrorResponse(error: unknown): NextResponse {
  if (error instanceof CsvFileTooLargeError) {
    return NextResponse.json({ error: error.message }, { status: 413 });
  }
  if (
    error instanceof CsvEmptyError ||
    error instanceof CsvTooManyRowsError ||
    error instanceof CsvMalformedRowError ||
    error instanceof CsvRowParseError ||
    error instanceof CsvColumnMappingError
  ) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return bankReconciliationErrorResponse(error);
}
