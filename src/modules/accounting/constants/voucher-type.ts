import { VoucherType } from "@prisma/client";

export const VOUCHER_TYPE_LABELS: Record<VoucherType, string> = {
  DEBIT_VOUCHER: "Debit Voucher",
  CREDIT_VOUCHER: "Credit Voucher",
  JOURNAL_VOUCHER: "Journal Voucher",
  CASH_VOUCHER: "Cash Voucher",
  // Not user-selectable — see USER_CREATABLE_VOUCHER_TYPES below.
  INVOICE_VOUCHER: "Invoice Voucher",
};

export const VOUCHER_TYPE_DESCRIPTIONS: Record<VoucherType, string> = {
  CASH_VOUCHER: "A cash/bank receipt or payment against a single other account.",
  DEBIT_VOUCHER: "Recording a payment or expense paid out of cash/bank.",
  CREDIT_VOUCHER: "Recording a receipt or income received into cash/bank.",
  JOURNAL_VOUCHER: "A full multi-line entry for anything that doesn't fit the simplified vouchers.",
  INVOICE_VOUCHER: "Auto-generated when an invoice is created — not directly selectable.",
};

// The voucher-type picker/form dropdowns only offer types a user can
// manually create through them. INVOICE_VOUCHER is stamped automatically by
// Invoice creation (see invoice.service.ts) and has no corresponding manual
// form, so it's excluded here rather than appearing as a dead-end option.
export const USER_CREATABLE_VOUCHER_TYPES: VoucherType[] = [
  "CASH_VOUCHER",
  "DEBIT_VOUCHER",
  "CREDIT_VOUCHER",
  "JOURNAL_VOUCHER",
];
