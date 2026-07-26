import { VoucherType } from "@prisma/client";

export const VOUCHER_TYPE_LABELS: Record<VoucherType, string> = {
  DEBIT_VOUCHER: "Debit Voucher",
  CREDIT_VOUCHER: "Credit Voucher",
  JOURNAL_VOUCHER: "Journal Voucher",
  CASH_VOUCHER: "Cash Voucher",
};

export const VOUCHER_TYPE_DESCRIPTIONS: Record<VoucherType, string> = {
  CASH_VOUCHER: "A cash/bank receipt or payment against a single other account.",
  DEBIT_VOUCHER: "Recording a payment or expense paid out of cash/bank.",
  CREDIT_VOUCHER: "Recording a receipt or income received into cash/bank.",
  JOURNAL_VOUCHER: "A full multi-line entry for anything that doesn't fit the simplified vouchers.",
};
