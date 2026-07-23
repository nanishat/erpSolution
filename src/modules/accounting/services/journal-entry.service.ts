import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { JournalEntryInput } from "@/modules/accounting/validations/journal-entry.schema";

const journalEntryInclude = {
  lines: { include: { account: true } },
} satisfies Prisma.JournalEntryInclude;

export type JournalEntryWithLines = Prisma.JournalEntryGetPayload<{
  include: typeof journalEntryInclude;
}>;

export async function getJournalEntries(): Promise<JournalEntryWithLines[]> {
  return db.journalEntry.findMany({
    include: journalEntryInclude,
    orderBy: { date: "desc" },
  });
}

export async function getJournalEntryById(
  id: string
): Promise<JournalEntryWithLines | null> {
  return db.journalEntry.findUnique({
    where: { id },
    include: journalEntryInclude,
  });
}

export async function createJournalEntry(
  input: JournalEntryInput,
  createdById: string
): Promise<JournalEntryWithLines> {
  return db.journalEntry.create({
    data: {
      date: input.date,
      description: input.description,
      reference: input.reference,
      branchId: input.branchId,
      createdById,
      lines: {
        create: input.lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
          memo: line.memo,
        })),
      },
    },
    include: journalEntryInclude,
  });
}
