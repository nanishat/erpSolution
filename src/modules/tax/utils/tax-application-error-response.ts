import { NextResponse } from "next/server";

import { JournalEntryNotFoundError } from "@/modules/accounting/services/journal-entry.service";
import { PartnerNotFoundError } from "@/modules/partners/services/partner.service";
import {
  PartnerTdsExemptError,
  TaxApplicationNotFoundError,
  TaxApplicationNotPendingError,
  TaxRateDirectionMismatchError,
  TaxRateInactiveError,
  TaxRateNotFoundError,
  TaxRateTypeMismatchError,
} from "@/modules/tax/services/tax-application.service";

export function taxApplicationErrorResponse(error: unknown): NextResponse {
  // TaxApplicationNotFoundError is the primary resource for approve/reject
  // (404). JournalEntry/Partner/TaxRate not-found here are references given
  // as *input* to a create call, not the primary resource — same convention
  // as PartnerLocalBranchNotFoundError in partner-error-response.ts (400).
  if (error instanceof TaxApplicationNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (
    error instanceof JournalEntryNotFoundError ||
    error instanceof PartnerNotFoundError ||
    error instanceof TaxRateNotFoundError
  ) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (
    error instanceof TaxApplicationNotPendingError ||
    error instanceof PartnerTdsExemptError
  ) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (
    error instanceof TaxRateTypeMismatchError ||
    error instanceof TaxRateDirectionMismatchError ||
    error instanceof TaxRateInactiveError
  ) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  console.error(error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
