import { z } from "zod";

export const journalLineSchema = z.object({
  accountId: z.string().min(1, "Account is required"),
  debit: z.coerce.number().min(0, "Debit cannot be negative").default(0),
  credit: z.coerce.number().min(0, "Credit cannot be negative").default(0),
  memo: z.string().optional(),
});

export const journalEntrySchema = z
  .object({
    date: z.coerce.date(),
    description: z.string().min(1, "Description is required"),
    reference: z.string().optional(),
    lines: z
      .array(journalLineSchema)
      .min(2, "A journal entry needs at least two line items"),
  })
  .superRefine((entry, ctx) => {
    entry.lines.forEach((line, index) => {
      if (line.debit > 0 && line.credit > 0) {
        ctx.addIssue({
          code: "custom",
          message: "A line item cannot have both a debit and a credit amount",
          path: ["lines", index],
        });
      }
      if (line.debit === 0 && line.credit === 0) {
        ctx.addIssue({
          code: "custom",
          message: "A line item needs a debit or a credit amount",
          path: ["lines", index],
        });
      }
    });

    const totalDebit = entry.lines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = entry.lines.reduce((sum, line) => sum + line.credit, 0);

    if (Math.round((totalDebit - totalCredit) * 100) !== 0) {
      ctx.addIssue({
        code: "custom",
        message: `Debits (${totalDebit}) must equal credits (${totalCredit})`,
        path: ["lines"],
      });
    }
  });

export type JournalLineInput = z.infer<typeof journalLineSchema>;
export type JournalEntryInput = z.infer<typeof journalEntrySchema>;
