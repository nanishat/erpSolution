import { z } from "zod";

const importBankStatementLineSchema = z.object({
  date: z.coerce.date(),
  description: z.string().min(1, "Description is required"),
  // Signed: positive = inflow/deposit, negative = outflow/withdrawal — see
  // BankStatementLine.amount in schema.prisma for the confirmed decision.
  // Zero is rejected here (mirrors the DB CHECK constraint) rather than left
  // for the DB to reject, same "validate twice" precedent as
  // recordPaymentSchema's amount.positive().
  amount: z.coerce.number().refine((value) => value !== 0, "Amount must not be zero"),
  referenceNo: z.string().optional(),
});

export const importBankStatementSchema = z.object({
  accountId: z.string().min(1, "Account is required"),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  openingBalance: z.coerce.number(),
  closingBalance: z.coerce.number(),
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

export type ImportBankStatementLineInput = z.infer<typeof importBankStatementLineSchema>;
export type ImportBankStatementInput = z.infer<typeof importBankStatementSchema>;
export type ConfirmMatchInput = z.infer<typeof confirmMatchSchema>;
export type UnmatchLineInput = z.infer<typeof unmatchLineSchema>;
