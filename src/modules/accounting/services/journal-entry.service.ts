import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { generateDocumentNumber } from "@/modules/accounting/services/document-sequence.service";
import type { JournalEntryInput } from "@/modules/accounting/validations/journal-entry.schema";

export class BranchNotFoundError extends Error {
  constructor(id: string) {
    super(`Branch ${id} not found`);
    this.name = "BranchNotFoundError";
  }
}

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
  return db.$transaction(async (tx) => {
    const branch = await tx.branch.findUnique({
      where: { id: input.branchId },
      select: { code: true },
    });
    if (!branch) {
      throw new BranchNotFoundError(input.branchId);
    }

    const documentNumber = await generateDocumentNumber(tx, {
      voucherType: input.voucherType,
      branchId: input.branchId,
      branchCode: branch.code,
      date: input.date,
    });

    return tx.journalEntry.create({
      data: {
        date: input.date,
        description: input.description,
        reference: input.reference,
        branchId: input.branchId,
        voucherType: input.voucherType,
        documentNumber,
        createdById,
        lines: {
          create: input.lines.map((line) => ({
            accountId: line.accountId,
            branchId: line.branchId,
            debit: line.debit,
            credit: line.credit,
            memo: line.memo,
          })),
        },
      },
      include: journalEntryInclude,
    });
  });
}
