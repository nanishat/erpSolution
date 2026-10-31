import { z } from "zod";

const importBankStatementLineSchema = z.object({
  date: z.coerce.date(),
  description: z.string({ error: "Enter a description." }).min(1, "Enter a description."),
  // Signed: positive = inflow/deposit, negative = outflow/withdrawal — see
  // BankStatementLine.amount in schema.prisma for the confirmed decision.
  // Zero is rejected here (mirrors the DB CHECK constraint) rather than left
  // for the DB to reject, same "validate twice" precedent as
  // recordPaymentSchema's amount.positive().
  amount: z.coerce.number({ error: "Enter an amount." }).refine((value) => value !== 0, "Enter an amount other than 0."),
  referenceNo: z.string().optional(),
});

export const importBankStatementSchema = z.object({
  accountId: z.string({ error: "Select an account." }).min(1, "Select an account."),
  periodStart: z.coerce.date({ error: "Enter a valid period start date." }),
  periodEnd: z.coerce.date({ error: "Enter a valid period end date." }),
  openingBalance: z.coerce.number({ error: "Enter an opening balance." }),
  closingBalance: z.coerce.number({ error: "Enter a closing balance." }),
  lines: z.array(importBankStatementLineSchema),

  // TODO: derive importedById from the authenticated session once auth is
  // wired up — same TODO as Payment.createdById in payment.schema.ts.
  importedById: z.coerce.number().int().optional(),
});

export const confirmMatchSchema = z.object({
  bankStatementLineId: z.string().min(1, "Bank statement line is required"),
  journalLineId: z.string().min(1, "Journal line is required"),

  // TODO: derive matchedById from the authenticated session once auth is
  // wired up.
  matchedById: z.coerce.number().int().optional(),
});

export const unmatchLineSchema = z.object({
  bankStatementLineId: z.string().min(1, "Bank statement line is required"),
});

export const ignoreLineSchema = z.object({
  bankStatementLineId: z.string().min(1, "Bank statement line is required"),
});

export const unignoreLineSchema = z.object({
  bankStatementLineId: z.string().min(1, "Bank statement line is required"),
});

export type ImportBankStatementLineInput = z.infer<typeof importBankStatementLineSchema>;
export type ImportBankStatementInput = z.infer<typeof importBankStatementSchema>;
export type ConfirmMatchInput = z.infer<typeof confirmMatchSchema>;
export type UnmatchLineInput = z.infer<typeof unmatchLineSchema>;
export type IgnoreLineInput = z.infer<typeof ignoreLineSchema>;
export type UnignoreLineInput = z.infer<typeof unignoreLineSchema>;
