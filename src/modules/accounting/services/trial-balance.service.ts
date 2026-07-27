import type { AccountType } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { TrialBalanceQuery } from "@/modules/accounting/validations/trial-balance.schema";

export type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  totalDebit: number;
  totalCredit: number;
  netBalance: number;
};

export type TrialBalanceResult = {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
};

// Normal-balance convention: ASSET/EXPENSE grow on the debit side,
// LIABILITY/EQUITY/REVENUE grow on the credit side.
const DEBIT_NORMAL_TYPES = new Set<AccountType>(["ASSET", "EXPENSE"]);

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function getTrialBalance(
  query: TrialBalanceQuery
): Promise<TrialBalanceResult> {
  // `to` is treated as inclusive of the whole day: bump to the start of the
  // next day and filter with `lt` so a date-only value like "2026-07-27"
  // still captures entries recorded later that same day.
  let dateFilter: Prisma.DateTimeFilter | undefined;
  if (query.from || query.to) {
    dateFilter = {};
    if (query.from) dateFilter.gte = query.from;
    if (query.to) {
      const exclusiveEnd = new Date(query.to);
      exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
      dateFilter.lt = exclusiveEnd;
    }
  }

  const [accounts, sums] = await Promise.all([
    db.chartOfAccount.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true },
    }),
    db.journalLine.groupBy({
      by: ["accountId"],
      where: {
        branchId: query.branchId,
        journalEntry: {
          status: "POSTED",
          date: dateFilter,
        },
      },
      _sum: { debit: true, credit: true },
    }),
  ]);

  const activityByAccountId = new Map(
    sums.map((sum) => [
      sum.accountId,
      { debit: Number(sum._sum.debit ?? 0), credit: Number(sum._sum.credit ?? 0) },
    ])
  );

  const rows: TrialBalanceRow[] = [];
  let totalDebit = 0;
  let totalCredit = 0;

  for (const account of accounts) {
    const activity = activityByAccountId.get(account.id) ?? { debit: 0, credit: 0 };

    if (!query.includeZeroBalances && activity.debit === 0 && activity.credit === 0) {
      continue;
    }

    const isDebitNormal = DEBIT_NORMAL_TYPES.has(account.type);
    const netBalance = isDebitNormal
      ? activity.debit - activity.credit
      : activity.credit - activity.debit;

    rows.push({
      accountId: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      totalDebit: activity.debit,
      totalCredit: activity.credit,
      netBalance: roundToCents(netBalance),
    });

    totalDebit += activity.debit;
    totalCredit += activity.credit;
  }

  totalDebit = roundToCents(totalDebit);
  totalCredit = roundToCents(totalCredit);

  return {
    rows,
    totalDebit,
    totalCredit,
    isBalanced: Math.round((totalDebit - totalCredit) * 100) === 0,
  };
}
