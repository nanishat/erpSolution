import { NextResponse } from "next/server";

import {
  BranchNotFoundError,
  CannotReverseAReversalError,
  InactiveAccountJournalLineError,
  JournalEntryAlreadyPostedError,
  JournalEntryAlreadyReversedError,
  JournalEntryNotDraftForVoidError,
  JournalEntryNotFoundError,
  JournalEntryNotPostedError,
  JournalEntryVoidError,
  PendingTaxApprovalError,
  UnbalancedJournalEntryError,
} from "@/modules/accounting/services/journal-entry.service";
import {
  AccountsPayableNotConfiguredError,
  AccountsReceivableNotConfiguredError,
  InvoiceAlreadyPostedError,
  InvoiceCancelledError,
  InvoiceHasPaymentsError,
  InvoiceLineMissingExpenseAccountError,
  InvoiceLineMissingIncomeAccountError,
  InvoiceNotCancellableError,
  InvoiceNotFoundError,
  InvoiceNotReversibleError,
  InvoicePaidCannotReverseError,
  InvoiceVoidError,
  PartnerNotCustomerError,
  PartnerNotVendorError,
  ProductServiceNotFoundError,
  UnbalancedInvoiceJournalEntryError,
} from "@/modules/invoicing/services/invoice.service";
import { PartnerNotFoundError } from "@/modules/partners/services/partner.service";

export function invoiceErrorResponse(error: unknown): NextResponse {
  if (error instanceof InvoiceNotFoundError || error instanceof PartnerNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (
    error instanceof InvoiceAlreadyPostedError ||
    error instanceof InvoiceCancelledError ||
    error instanceof InvoiceVoidError ||
    error instanceof InvoiceNotCancellableError ||
    error instanceof InvoiceNotReversibleError ||
    error instanceof InvoicePaidCannotReverseError ||
    error instanceof InvoiceHasPaymentsError ||
    error instanceof PendingTaxApprovalError ||
    // The linked JournalEntry is expected to be DRAFT/POSTED/found in
    // lockstep with its Invoice's own status (they're created and
    // transitioned together) — these only fire if that invariant is
    // somehow broken (e.g. the entry was posted/reversed directly via the
    // general journal entries UI, bypassing postInvoice/cancelInvoice/
    // reverseInvoice entirely), so they're surfaced as conflicts rather
    // than reimplemented/silently swallowed here.
    error instanceof JournalEntryAlreadyPostedError ||
    error instanceof JournalEntryVoidError ||
    error instanceof JournalEntryNotFoundError ||
    error instanceof JournalEntryNotPostedError ||
    error instanceof JournalEntryAlreadyReversedError ||
    error instanceof CannotReverseAReversalError ||
    error instanceof JournalEntryNotDraftForVoidError
  ) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (
    error instanceof UnbalancedJournalEntryError ||
    error instanceof UnbalancedInvoiceJournalEntryError ||
    error instanceof InactiveAccountJournalLineError ||
    error instanceof BranchNotFoundError ||
    error instanceof PartnerNotCustomerError ||
    error instanceof PartnerNotVendorError ||
    error instanceof ProductServiceNotFoundError ||
    error instanceof InvoiceLineMissingIncomeAccountError ||
    error instanceof InvoiceLineMissingExpenseAccountError ||
    error instanceof AccountsReceivableNotConfiguredError ||
    error instanceof AccountsPayableNotConfiguredError
  ) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  console.error(error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
