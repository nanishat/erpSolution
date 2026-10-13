import type { AccountType } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { db } from "@/lib/db";
import type { TrialBalanceQuery } from "@/modules/accounting/validations/trial-balance.schema";
import {
  getNormalBalance,
  REPORTABLE_JOURNAL_ENTRY_WHERE,
  rollupHeaderTotals,
  type AccountReportTotals,
} from "@/modules/accounting/services/report-utils";

export type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  totalDebit: number;
  totalCredit: number;
  netBalance: number;
};

export type TrialBalanceGroup = {
  row: TrialBalanceRow;
  children: TrialBalanceGroup[];
};

export type TrialBalanceResult = {
  rows: TrialBalanceRow[];
  groups: TrialBalanceGroup[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
};

function serializeAmount(amount: PrismaNamespace.Decimal): number {
  return Number(amount.toFixed(2));
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
      select: { id: true, code: true, name: true, type: true, parentId: true },
    }),
    db.journalLine.groupBy({
      by: ["accountId"],
      where: {
        branchId: query.branchId,
        journalEntry: {
          // Exclude unlinked VOID entries while retaining linked reversal pairs.
          ...REPORTABLE_JOURNAL_ENTRY_WHERE,
          date: dateFilter,
        },
      },
      _sum: { debit: true, credit: true },
    }),
  ]);

  const activityByAccountId = new Map(
    sums.map((sum) => [
      sum.accountId,
      {
        debit: sum._sum.debit ?? new PrismaNamespace.Decimal(0),
        credit: sum._sum.credit ?? new PrismaNamespace.Decimal(0),
      },
    ])
  );

  const totalsByAccountId = new Map<string, AccountReportTotals>();
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const childrenByParentId = new Map<string, typeof accounts>();
  for (const account of accounts) {
    if (!account.parentId) continue;
    const children = childrenByParentId.get(account.parentId) ?? [];
    children.push(account);
    childrenByParentId.set(account.parentId, children);
  }

  for (const account of accounts) {
    const activity = activityByAccountId.get(account.id) ?? {
      debit: new PrismaNamespace.Decimal(0),
      credit: new PrismaNamespace.Decimal(0),
    };
    totalsByAccountId.set(account.id, {
      debit: activity.debit,
      credit: activity.credit,
      balance: getNormalBalance(account.type, activity.debit, activity.credit),
    });
  }

  const depthOf = (account: (typeof accounts)[number]) => {
    let depth = 0;
    let current = account;
    const visited = new Set([account.id]);
    while (current.parentId) {
      const parent = accountById.get(current.parentId);
      if (!parent || visited.has(parent.id)) break;
      visited.add(parent.id);
      depth += 1;
      current = parent;
    }
    return depth;
  };
  const rolledUpTotals = rollupHeaderTotals(
    [...accounts].sort((left, right) => depthOf(right) - depthOf(left)),
    totalsByAccountId
  );

  const rows: TrialBalanceRow[] = [];
  let totalDebit = new PrismaNamespace.Decimal(0);
  let totalCredit = new PrismaNamespace.Decimal(0);

  for (const account of accounts) {
    const totals = totalsByAccountId.get(account.id)!;

    if (!query.includeZeroBalances && totals.debit.isZero() && totals.credit.isZero()) {
      continue;
    }

    rows.push({
      accountId: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      totalDebit: serializeAmount(totals.debit),
      totalCredit: serializeAmount(totals.credit),
      netBalance: serializeAmount(totals.balance),
    });

    totalDebit = totalDebit.plus(totals.debit);
    totalCredit = totalCredit.plus(totals.credit);
  }

  const makeGroup = (accountId: string): TrialBalanceGroup | null => {
    const account = accountById.get(accountId)!;
    const children = (childrenByParentId.get(accountId) ?? [])
      .map((child) => makeGroup(child.id))
      .filter((child): child is TrialBalanceGroup => child !== null);

    if (children.length === 0 && childrenByParentId.has(accountId)) return null;

    const totals = childrenByParentId.has(accountId)
      ? rolledUpTotals.get(accountId)!
      : totalsByAccountId.get(accountId)!;
    if (
      children.length === 0 &&
      !query.includeZeroBalances &&
      totals.debit.isZero() &&
      totals.credit.isZero()
    ) {
      return null;
    }

    const row: TrialBalanceRow = {
      accountId: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      totalDebit: serializeAmount(totals.debit),
      totalCredit: serializeAmount(totals.credit),
      netBalance: serializeAmount(totals.balance),
    };
    return { row, children };
  };
  const groups = accounts
    .filter((account) => account.parentId === null)
    .map((account) => makeGroup(account.id))
    .filter((group): group is TrialBalanceGroup => group !== null);

  return {
    rows,
    groups,
    totalDebit: serializeAmount(totalDebit),
    totalCredit: serializeAmount(totalCredit),
    isBalanced: totalDebit.minus(totalCredit).isZero(),
  };
}
