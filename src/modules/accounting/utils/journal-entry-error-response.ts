import { NextResponse } from "next/server";

import {
  BranchNotFoundError,
  CannotReverseAReversalError,
  InactiveAccountJournalLineError,
  JournalEntryAlreadyPostedError,
  JournalEntryAlreadyReversedError,
  JournalEntryImmutableError,
  JournalEntryNotFoundError,
  JournalEntryNotPostedError,
  JournalEntryVoidError,
  PendingTaxApprovalError,
  UnbalancedJournalEntryError,
} from "@/modules/accounting/services/journal-entry.service";

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
    error instanceof PendingTaxApprovalError
  ) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (
    error instanceof UnbalancedJournalEntryError ||
    error instanceof InactiveAccountJournalLineError ||
    error instanceof BranchNotFoundError
  ) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  console.error(error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
