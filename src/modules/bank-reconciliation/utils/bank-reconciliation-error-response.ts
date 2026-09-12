import { NextResponse } from "next/server";

import {
  AccountMismatchError,
  BankStatementBalanceMismatchError,
  BankStatementLineMismatchError,
  BankStatementLineNotFoundError,
  BankStatementNotFoundError,
  JournalLineAlreadyMatchedError,
  JournalLineNotFoundError,
  LineAlreadyMatchedError,
  LineNotMatchedError,
  ReconciliationAccountNotFoundError,
} from "@/modules/bank-reconciliation/services/bank-reconciliation.service";

export function bankReconciliationErrorResponse(error: unknown): NextResponse {
  if (
    error instanceof BankStatementNotFoundError ||
    error instanceof BankStatementLineNotFoundError ||
    error instanceof JournalLineNotFoundError
  ) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (
    error instanceof LineAlreadyMatchedError ||
    error instanceof JournalLineAlreadyMatchedError ||
    error instanceof LineNotMatchedError
  ) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (
    error instanceof ReconciliationAccountNotFoundError ||
    error instanceof BankStatementBalanceMismatchError ||
    error instanceof AccountMismatchError ||
    error instanceof BankStatementLineMismatchError
  ) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  console.error(error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
