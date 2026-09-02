import { z } from "zod";

// Debit Voucher always debits 1-5 expense/payable lines against one shared
// Cash/Bank account (the credit side) — direction is fixed, unlike the
// general Journal Voucher, so each line only carries a single positive
// amount rather than separate debit/credit fields (see journalLineSchema in
// journal-entry.schema.ts for the general-voucher shape this deliberately
// does not reuse).
export const debitVoucherLineSchema = z.object({
  expenseAccountId: z.string().min(1, "Account is required"),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  description: z.string().optional(),
});

// bankName/chequeNo/chequeDate are accepted here as plain optional fields —
// whether they're actually *required* depends on the AccountSubType of
// cashBankAccountId, which only the DB knows, so that check happens
// server-side in createDebitVoucher (see BankDetailsRequiredError), not here.
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
    bankName: z.string().trim().min(1).optional(),
    chequeNo: z.string().trim().min(1).optional(),
    chequeDate: z.coerce.date().optional(),
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
