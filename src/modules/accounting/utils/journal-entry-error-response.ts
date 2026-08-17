import { NextResponse } from "next/server";

import {
  BranchNotFoundError,
  CannotReverseAReversalError,
  InactiveAccountJournalLineError,
  JournalEntryAlreadyPostedError,
  JournalEntryAlreadyReversedError,
  JournalEntryImmutableError,
  JournalEntryMustEditViaInvoiceError,
  JournalEntryMustPostViaInvoiceError,
  JournalEntryNotFoundError,
  JournalEntryNotPostedError,
  JournalEntryVoidError,
  PendingTaxApprovalError,
  UnbalancedJournalEntryError,
} from "@/modules/accounting/services/journal-entry.service";
import {
  TaxAccountNotConfiguredError,
  TaxAmountExceedsSettlementError,
  TaxSettlementLineAmbiguousError,
  TaxSettlementLineNotFoundError,
} from "@/modules/tax/services/tax-posting.service";

export function journalEntryErrorResponse(error: unknown): NextResponse {
  if (error instanceof JournalEntryNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (
    error instanceof JournalEntryAlreadyPostedError ||
    error instanceof JournalEntryVoidError ||
    error instanceof JournalEntryImmutableError ||
    error instanceof JournalEntryNotPostedError ||
    error instanceof JournalEntryAlreadyReversedError ||
    error instanceof CannotReverseAReversalError ||
    error instanceof PendingTaxApprovalError ||
    error instanceof JournalEntryMustPostViaInvoiceError ||
    error instanceof JournalEntryMustEditViaInvoiceError
  ) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (
    error instanceof UnbalancedJournalEntryError ||
    error instanceof InactiveAccountJournalLineError ||
    error instanceof BranchNotFoundError ||
    error instanceof TaxAccountNotConfiguredError ||
    error instanceof TaxSettlementLineNotFoundError ||
    error instanceof TaxSettlementLineAmbiguousError ||
    error instanceof TaxAmountExceedsSettlementError
  ) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  console.error(error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
