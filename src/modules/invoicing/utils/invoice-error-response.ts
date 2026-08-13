import { NextResponse } from "next/server";

import {
  InactiveAccountJournalLineError,
  JournalEntryAlreadyPostedError,
  JournalEntryNotFoundError,
  JournalEntryVoidError,
  PendingTaxApprovalError,
  UnbalancedJournalEntryError,
} from "@/modules/accounting/services/journal-entry.service";
import {
  InvoiceAlreadyPostedError,
  InvoiceCancelledError,
  InvoiceNotFoundError,
  InvoiceVoidError,
} from "@/modules/invoicing/services/invoice.service";

export function invoiceErrorResponse(error: unknown): NextResponse {
  if (error instanceof InvoiceNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (
    error instanceof InvoiceAlreadyPostedError ||
    error instanceof InvoiceCancelledError ||
    error instanceof InvoiceVoidError ||
    error instanceof PendingTaxApprovalError ||
    // The linked JournalEntry is expected to be DRAFT/found whenever its
    // Invoice is DRAFT (they're created and transitioned together) — these
    // only fire if that invariant is somehow broken, so they're surfaced
    // as conflicts rather than reimplemented/silently swallowed here.
    error instanceof JournalEntryAlreadyPostedError ||
    error instanceof JournalEntryVoidError ||
    error instanceof JournalEntryNotFoundError
  ) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (
    error instanceof UnbalancedJournalEntryError ||
    error instanceof InactiveAccountJournalLineError
  ) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  console.error(error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
