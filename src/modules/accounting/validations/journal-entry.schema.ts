import { VoucherType } from "@prisma/client";
import { z } from "zod";

import { CREDIT_VOUCHER_SECTOR_CODES } from "@/modules/accounting/constants/sector";

export const journalLineSchema = z.object({
  accountId: z.string({ error: "Select an account." }).min(1, "Select an account."),
  branchId: z.string({ error: "Select a branch." }).min(1, "Select a branch."),
  debit: z.coerce.number({ error: "Enter a debit amount." }).min(0, "Debit must be 0 or more.").default(0),
  credit: z.coerce.number({ error: "Enter a credit amount." }).min(0, "Credit must be 0 or more.").default(0),
  memo: z.string().optional(),
});

type LinesEntry = { lines: z.infer<typeof journalLineSchema>[] };

// Shared by create/update schemas so both enforce the same debit=credit
// invariant — used at input-validation time only; posting re-checks it
// against live DB state independently (see journal-entry.service.ts).
function validateBalancedLines(entry: LinesEntry, ctx: z.RefinementCtx) {
  entry.lines.forEach((line, index) => {
    if (line.debit > 0 && line.credit > 0) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a debit or credit amount, not both.",
        path: ["lines", index],
      });
    }
    if (line.debit === 0 && line.credit === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a debit or credit amount.",
        path: ["lines", index],
      });
    }
  });

  const totalDebit = entry.lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = entry.lines.reduce((sum, line) => sum + line.credit, 0);

  if (Math.round((totalDebit - totalCredit) * 100) !== 0) {
    ctx.addIssue({
      code: "custom",
      message: "Total debit and total credit must be equal.",
      path: ["lines"],
    });
  }
}

export const journalEntrySchema = z
  .object({
    date: z.coerce.date({ error: "Enter a valid date." }),
    description: z.string({ error: "Enter a description." }).min(1, "Enter a description."),
    reference: z.string().optional(),
    branchId: z.string({ error: "Select a branch." }).min(1, "Select a branch."),
    voucherType: z.nativeEnum(VoucherType, { error: "Select a voucher type." }),
    sector: z.enum(CREDIT_VOUCHER_SECTOR_CODES).nullable().optional(),
    lines: z
      .array(journalLineSchema)
      .min(2, "Add at least two entries."),
  })
  .superRefine((entry, ctx) => {
    validateBalancedLines(entry, ctx);
    if (
      entry.voucherType !== VoucherType.CREDIT_VOUCHER &&
      entry.sector !== undefined &&
      entry.sector !== null
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Sector can only be set on a Credit Voucher",
        path: ["sector"],
      });
    }
  });

// voucherType/branchId/documentNumber are fixed at creation (the document
// number is stamped from voucherType) so editing a DRAFT entry can't change
// them — only date/description/reference/sector/lines are mutable.
export const updateJournalEntrySchema = z
  .object({
    date: z.coerce.date({ error: "Enter a valid date." }),
    description: z.string({ error: "Enter a description." }).min(1, "Enter a description."),
    reference: z.string().optional(),
    sector: z.enum(CREDIT_VOUCHER_SECTOR_CODES).nullable().optional(),
    lines: z
      .array(journalLineSchema)
      .min(2, "Add at least two entries."),
  })
  .superRefine(validateBalancedLines);

export const reverseJournalEntrySchema = z.object({
  reason: z.string().trim().min(1).optional(),
});

export type JournalLineInput = z.infer<typeof journalLineSchema>;
export type JournalEntryInput = z.infer<typeof journalEntrySchema>;
export type UpdateJournalEntryInput = z.infer<typeof updateJournalEntrySchema>;
export type ReverseJournalEntryInput = z.infer<typeof reverseJournalEntrySchema>;
