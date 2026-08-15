import { z } from "zod";

export const recordPaymentSchema = z.object({
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  date: z.coerce.date(),
  method: z.string().optional(),
  reference: z.string().optional(),

  // Which Cash/Bank ChartOfAccount this payment moves through — same
  // account picker convention as CashBankVoucherForm (subType CASH/BANK),
  // required rather than hardcoded since branches may use different accounts.
  cashBankAccountId: z.string().min(1, "Cash/Bank account is required"),

  // TODO: derive createdById from the authenticated session once auth is wired up.
  createdById: z.coerce.number().int().optional(),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
