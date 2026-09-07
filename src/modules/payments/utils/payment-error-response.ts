import { NextResponse } from "next/server";

import {
  InactiveAccountJournalLineError,
  UnbalancedJournalEntryError,
} from "@/modules/accounting/services/journal-entry.service";
import {
  AccountsPayableNotConfiguredError,
  AccountsReceivableNotConfiguredError,
  InvoiceNotFoundError,
} from "@/modules/invoicing/services/invoice.service";
import { PartnerNotFoundError } from "@/modules/partners/services/partner.service";
import {
  CashBankAccountNotFoundError,
  CreditAmountExceedsRemainingError,
  CreditInvoicePartnerMismatchError,
  InvoiceBelongsToDifferentPartnerError,
  InvoiceDirectionMismatchError,
  InvoiceNotPayableError,
  PartnerCreditNotApplicableError,
  PartnerCreditNotFoundError,
  PaymentAllocationExceedsAmountError,
  PaymentExceedsRemainingBalanceError,
} from "@/modules/payments/services/payment.service";

export function paymentErrorResponse(error: unknown): NextResponse {
  if (
    error instanceof InvoiceNotFoundError ||
    error instanceof PartnerNotFoundError ||
    error instanceof PartnerCreditNotFoundError
  ) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (
    error instanceof InvoiceNotPayableError ||
    error instanceof PaymentExceedsRemainingBalanceError ||
    error instanceof PartnerCreditNotApplicableError ||
    error instanceof CreditAmountExceedsRemainingError
  ) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (
    error instanceof CashBankAccountNotFoundError ||
    error instanceof AccountsReceivableNotConfiguredError ||
    error instanceof AccountsPayableNotConfiguredError ||
    error instanceof UnbalancedJournalEntryError ||
    error instanceof InactiveAccountJournalLineError ||
    error instanceof PaymentAllocationExceedsAmountError ||
    error instanceof InvoiceBelongsToDifferentPartnerError ||
    error instanceof InvoiceDirectionMismatchError ||
    error instanceof CreditInvoicePartnerMismatchError
  ) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  console.error(error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
