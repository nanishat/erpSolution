import { z } from "zod";

const paymentAllocationSchema = z.object({
  invoiceId: z.string().min(1, "Invoice is required"),
  amountApplied: z.coerce.number().positive("Amount applied must be greater than zero"),
});

// Shared by recordPaymentSchema below — sum(allocations.amountApplied) must
// not exceed amount (leftover becomes an overpayment credit, not an error;
// exceeding is an application-amount error — see recordPayment's own check
// against live DB state, which this mirrors at the input-validation layer
// only, same "validate twice" precedent as journalEntrySchema's
// validateBalancedLines).
function validateAllocationsWithinAmount(
  input: { amount: number; allocations: { amountApplied: number }[] },
  ctx: z.RefinementCtx
) {
  const totalAllocated = input.allocations.reduce((sum, a) => sum + a.amountApplied, 0);
  if (Math.round((totalAllocated - input.amount) * 100) > 0) {
    ctx.addIssue({
      code: "custom",
      message: `Sum of allocations (${totalAllocated}) cannot exceed the payment amount (${input.amount})`,
      path: ["allocations"],
    });
  }
}

const baseRecordPaymentFields = {
  partnerId: z.string().min(1, "Partner is required"),

  // Not in the original task's input shape, but required: JournalEntry.branchId
  // is NOT NULL and a Partner has no reliable non-null branch of its own
  // (localBranchId is nullable/company-wide) to derive it from, and a
  // multi-invoice payment's allocated invoices can span different branches
  // anyway. recordPaymentForInvoice (the legacy single-invoice adapter)
  // fills this in from the invoice's own branchId automatically, so
  // RecordPaymentForm.tsx/POST /api/invoices/[id]/payments callers are
  // unaffected — only the new general POST /api/payments caller must supply it.
  branchId: z.string().min(1, "Branch is required"),

  amount: z.coerce.number().positive("Amount must be greater than zero"),
  date: z.coerce.date(),
  method: z.string().optional(),
  reference: z.string().optional(),

  // Which Cash/Bank ChartOfAccount this payment moves through — same
  // account picker convention as CashBankVoucherForm (subType CASH/BANK),
  // required rather than hardcoded since branches may use different accounts.
  cashBankAccountId: z.string().min(1, "Cash/Bank account is required"),

  allocations: z.array(paymentAllocationSchema).default([]),

  // TODO: derive createdById from the authenticated session once auth is wired up.
  createdById: z.coerce.number().int().optional(),
};

export const recordPaymentSchema = z
  .object(baseRecordPaymentFields)
  .superRefine(validateAllocationsWithinAmount);

// Legacy single-invoice shape — powers POST /api/invoices/[id]/payments and
// RecordPaymentForm.tsx, which know the invoice (and therefore the partner
// and the one allocation) from the URL/page context, not the request body.
// The route derives partnerId from the invoice and builds a single-element
// allocations array of the full amount, then delegates to the same
// recordPayment as every other caller — see recordPaymentForInvoice in
// payment.service.ts.
export const recordPaymentForInvoiceSchema = z
  .object(baseRecordPaymentFields)
  .omit({ partnerId: true, branchId: true, allocations: true });

export const applyPartnerCreditSchema = z.object({
  partnerCreditId: z.string().min(1, "Partner credit is required"),
  invoiceId: z.string().min(1, "Invoice is required"),
  amountToApply: z.coerce.number().positive("Amount to apply must be greater than zero"),
});

export type PaymentAllocationInput = z.infer<typeof paymentAllocationSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type RecordPaymentForInvoiceInput = z.infer<typeof recordPaymentForInvoiceSchema>;
export type ApplyPartnerCreditInput = z.infer<typeof applyPartnerCreditSchema>;
