import { VoucherType } from "@prisma/client";

export const VOUCHER_TYPE_LABELS: Record<VoucherType, string> = {
  DEBIT_VOUCHER: "Debit Voucher",
  CREDIT_VOUCHER: "Credit Voucher",
  JOURNAL_VOUCHER: "Journal Voucher",
  CASH_VOUCHER: "Cash Voucher",
  // Not user-selectable — see USER_CREATABLE_VOUCHER_TYPES below.
  INVOICE_VOUCHER: "Invoice Voucher",
  PAYMENT_VOUCHER: "Payment Voucher",
};

export const VOUCHER_TYPE_DESCRIPTIONS: Record<VoucherType, string> = {
  CASH_VOUCHER: "A cash/bank receipt or payment against a single other account.",
  DEBIT_VOUCHER: "Recording a payment or expense paid out of cash/bank.",
  CREDIT_VOUCHER: "Recording a receipt or income received into cash/bank.",
  JOURNAL_VOUCHER: "A full multi-line entry for anything that doesn't fit the simplified vouchers.",
  INVOICE_VOUCHER: "Auto-generated when an invoice is created — not directly selectable.",
  PAYMENT_VOUCHER: "Auto-generated when a payment is recorded against an invoice — not directly selectable.",
};

// The voucher-type picker/form dropdowns only offer types a user can
// manually create through them. INVOICE_VOUCHER/PAYMENT_VOUCHER are stamped
// automatically by Invoice creation/payment recording (see
// invoice.service.ts / payment.service.ts) and have no corresponding manual
// form, so they're excluded here rather than appearing as dead-end options.
export const USER_CREATABLE_VOUCHER_TYPES: VoucherType[] = [
  "CASH_VOUCHER",
  "DEBIT_VOUCHER",
  "CREDIT_VOUCHER",
  "JOURNAL_VOUCHER",
];
