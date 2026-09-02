import { z } from "zod";

// Debit Voucher always debits 1-5 expense/payable lines against one shared
// Cash/Bank account (the credit side) — direction is fixed, unlike the
// general Journal Voucher, so each line only carries a single positive
// amount rather than separate debit/credit fields (see journalLineSchema in
// journal-entry.schema.ts for the general-voucher shape this deliberately
// does not reuse).
// bankName/chequeNo/chequeDate live per line (not on the voucher as a
// whole): each bill/line may be paid via a different cheque drawn on the
// one shared Cash/Bank account, even though the account itself doesn't vary
// per line. Plain optional fields here — whether they're actually
// *required* depends on the AccountSubType of cashBankAccountId, which only
// the DB knows, so debitVoucherSchema alone can't enforce it. See
// debitVoucherSchemaWithBankRequirement below, which layers that check on
// top once createDebitVoucher has looked the account up.
export const debitVoucherLineSchema = z.object({
  expenseAccountId: z.string().min(1, "Account is required"),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  description: z.string().optional(),
  bankName: z.string().trim().min(1).optional(),
  chequeNo: z.string().trim().min(1).optional(),
  chequeDate: z.coerce.date().optional(),
});

export const debitVoucherSchema = z
  .object({
    date: z.coerce.date(),
    description: z.string().min(1, "Description is required"),
    branchId: z.string().min(1, "Branch is required"),
    cashBankAccountId: z.string().min(1, "Cash/Bank account is required"),
    lines: z
      .array(debitVoucherLineSchema)
      .min(1, "At least one line is required")
      .max(5, "At most 5 lines are allowed"),
  })
  .superRefine((entry, ctx) => {
    const total = entry.lines.reduce((sum, line) => sum + line.amount, 0);
    if (!(total > 0)) {
      ctx.addIssue({
        code: "custom",
        message: "Sum of line amounts must be greater than zero",
        path: ["lines"],
      });
    }
  });

export type DebitVoucherLineInput = z.infer<typeof debitVoucherLineSchema>;
export type DebitVoucherInput = z.infer<typeof debitVoucherSchema>;

// Layers the Bank-account conditional requirement on top of
// debitVoucherSchema, once the caller knows (from the DB) whether
// cashBankAccountId resolves to a Bank-type account. Each line is checked
// independently so a missing field on one line reports an issue scoped to
// that line's path (["lines", index, field]) rather than one generic
// voucher-level failure — see BankDetailsRequiredError in
// debit-voucher.service.ts, which turns these issues into a message that
// names the specific line(s).
export function debitVoucherSchemaWithBankRequirement(isBankAccount: boolean) {
  return debitVoucherSchema.superRefine((entry, ctx) => {
    if (!isBankAccount) {
      return;
    }
    entry.lines.forEach((line, index) => {
      if (!line.bankName?.trim()) {
        ctx.addIssue({
          code: "custom",
          message: "Bank Name is required for a Bank account",
          path: ["lines", index, "bankName"],
        });
      }
      if (!line.chequeNo?.trim()) {
        ctx.addIssue({
          code: "custom",
          message: "Cheque No is required for a Bank account",
          path: ["lines", index, "chequeNo"],
        });
      }
      if (!line.chequeDate) {
        ctx.addIssue({
          code: "custom",
          message: "Cheque Date is required for a Bank account",
          path: ["lines", index, "chequeDate"],
        });
      }
    });
  });
}
