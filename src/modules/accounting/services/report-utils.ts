import type { AccountType, Prisma } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";
import { z } from "zod";

// ASSET and EXPENSE balances increase with debits; all other account types
// increase with credits.
export const DEBIT_NORMAL_TYPES: ReadonlySet<AccountType> = new Set(["ASSET", "EXPENSE"]);

export function getNormalBalance(
  accountType: AccountType,
  debit: Prisma.Decimal,
  credit: Prisma.Decimal
): Prisma.Decimal {
  return DEBIT_NORMAL_TYPES.has(accountType) ? debit.minus(credit) : credit.minus(debit);
}

function reportDateRangeIsValid(value: { from?: string; to?: string }) {
  return !value.from || !value.to || value.from <= value.to;
}

export const reportFiltersSchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    branchId: z.string().min(1).optional(),
  })
  .refine(reportDateRangeIsValid, {
    message: "'from' must be on or before 'to'",
    path: ["from"],
  });

export const generalLedgerQuerySchema = reportFiltersSchema.and(
  z.object({
    accountId: z.string().min(1).optional(),
  })
);

export type GeneralLedgerQuery = z.infer<typeof generalLedgerQuerySchema>;

// Reversed originals remain reportable (with status VOID) so they pair with
// their POSTED reversal; unrelated VOID entries never affected the ledger.
export const REPORTABLE_JOURNAL_ENTRY_WHERE = {
  OR: [
    { status: "POSTED" },
    { status: "VOID", reversedByEntry: { isNot: null } },
  ],
} satisfies Prisma.JournalEntryWhereInput;

export type AccountReportTotals = {
  debit: PrismaNamespace.Decimal;
  credit: PrismaNamespace.Decimal;
  balance: PrismaNamespace.Decimal;
};

export function rollupHeaderTotals(
  accounts: readonly { id: string; parentId: string | null }[],
  totalsByAccountId: ReadonlyMap<string, AccountReportTotals>
): Map<string, AccountReportTotals> {
  const rolledUp = new Map(totalsByAccountId);

  for (const header of accounts) {
    const children = accounts.filter((account) => account.parentId === header.id);
    if (children.length === 0) continue;

    const totals = {
      debit: new PrismaNamespace.Decimal(0),
      credit: new PrismaNamespace.Decimal(0),
      balance: new PrismaNamespace.Decimal(0),
    };
    for (const child of children) {
      const childTotals = rolledUp.get(child.id);
      if (!childTotals) continue;
      totals.debit = totals.debit.plus(childTotals.debit);
      totals.credit = totals.credit.plus(childTotals.credit);
      totals.balance = totals.balance.plus(childTotals.balance);
    }
    rolledUp.set(header.id, totals);
  }

  return rolledUp;
}
