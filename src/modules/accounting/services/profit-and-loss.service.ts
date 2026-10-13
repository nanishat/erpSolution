import type { AccountType, Prisma } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { db } from "@/lib/db";
import {
  getNormalBalance,
  reportFiltersSchema,
  REPORTABLE_JOURNAL_ENTRY_WHERE,
  rollupHeaderTotals,
  type AccountReportTotals,
  type GeneralLedgerQuery,
} from "@/modules/accounting/services/report-utils";

export type ProfitAndLossRow = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  amount: number;
};

export type ProfitAndLossGroup = {
  row: ProfitAndLossRow;
  children: ProfitAndLossGroup[];
};

export type ProfitAndLossResult = {
  revenue: { groups: ProfitAndLossGroup[]; total: number };
  expenses: { groups: ProfitAndLossGroup[]; total: number };
  totalRevenue: number;
  totalExpense: number;
  netProfit: number;
};

export class ProfitAndLossBranchNotFoundError extends Error {
  constructor(id: string) {
    super(`Branch ${id} not found`);
    this.name = "ProfitAndLossBranchNotFoundError";
  }
}

function serializeAmount(amount: PrismaNamespace.Decimal): number {
  return Number(amount.toFixed(2));
}

function startOfDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function nextDate(date: Date): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export async function getProfitAndLoss(
  query: Pick<GeneralLedgerQuery, "from" | "to" | "branchId">
): Promise<ProfitAndLossResult> {
  const filters = reportFiltersSchema.parse(query);

  if (filters.branchId) {
    const branch = await db.branch.findUnique({
      where: { id: filters.branchId },
      select: { id: true },
    });
    if (!branch) throw new ProfitAndLossBranchNotFoundError(filters.branchId);
  }

  const accounts = await db.chartOfAccount.findMany({
    where: { type: { in: ["REVENUE", "EXPENSE"] } },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, type: true, parentId: true },
  });

  const date: Prisma.DateTimeFilter = {};
  if (filters.from) date.gte = startOfDate(filters.from);
  if (filters.to) date.lt = nextDate(startOfDate(filters.to));

  const activity = accounts.length
    ? await db.journalLine.groupBy({
        by: ["accountId"],
        where: {
          accountId: { in: accounts.map((account) => account.id) },
          branchId: filters.branchId,
          journalEntry: {
            ...REPORTABLE_JOURNAL_ENTRY_WHERE,
            ...(Object.keys(date).length > 0 ? { date } : {}),
          },
        },
        _sum: { debit: true, credit: true },
      })
    : [];

  const activityByAccountId = new Map(
    activity.map((sum) => [
      sum.accountId,
      {
        debit: sum._sum.debit ?? new PrismaNamespace.Decimal(0),
        credit: sum._sum.credit ?? new PrismaNamespace.Decimal(0),
      },
    ])
  );
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const childrenByParentId = new Map<string, typeof accounts>();
  for (const account of accounts) {
    if (!account.parentId) continue;
    const children = childrenByParentId.get(account.parentId) ?? [];
    children.push(account);
    childrenByParentId.set(account.parentId, children);
  }

  const depthOf = (account: (typeof accounts)[number]) => {
    let depth = 0;
    let current = account;
    const visited = new Set([account.id]);
    while (current.parentId) {
      const parent = accountsById.get(current.parentId);
      if (!parent || visited.has(parent.id)) break;
      visited.add(parent.id);
      depth += 1;
      current = parent;
    }
    return depth;
  };

  const buildSection = (type: "REVENUE" | "EXPENSE") => {
    const sectionAccounts = accounts.filter((account) => account.type === type);
    const totalsByAccountId = new Map<string, AccountReportTotals>();

    for (const account of sectionAccounts) {
      const totals = activityByAccountId.get(account.id) ?? {
        debit: new PrismaNamespace.Decimal(0),
        credit: new PrismaNamespace.Decimal(0),
      };
      totalsByAccountId.set(account.id, {
        ...totals,
        balance: getNormalBalance(account.type, totals.debit, totals.credit),
      });
    }

    const rolledUpTotals = rollupHeaderTotals(
      [...sectionAccounts].sort((left, right) => depthOf(right) - depthOf(left)),
      totalsByAccountId
    );

    const makeGroup = (accountId: string): ProfitAndLossGroup | null => {
      const account = accountsById.get(accountId)!;
      const children = (childrenByParentId.get(accountId) ?? [])
        .filter((child) => child.type === type)
        .map((child) => makeGroup(child.id))
        .filter((child): child is ProfitAndLossGroup => child !== null);
      const hasChildren = (childrenByParentId.get(accountId) ?? []).some(
        (child) => child.type === type
      );
      const totals = hasChildren
        ? rolledUpTotals.get(accountId)!
        : totalsByAccountId.get(accountId)!;

      if (
        children.length === 0 &&
        totals.debit.isZero() &&
        totals.credit.isZero()
      ) {
        return null;
      }

      return {
        row: {
          accountId: account.id,
          code: account.code,
          name: account.name,
          type: account.type,
          amount: serializeAmount(totals.balance),
        },
        children,
      };
    };

    const rootAccounts = sectionAccounts.filter(
      (account) => !account.parentId || !accountsById.has(account.parentId)
    );
    const groups = rootAccounts
      .map((account) => makeGroup(account.id))
      .filter((group): group is ProfitAndLossGroup => group !== null);
    const total = rootAccounts.reduce(
      (sum, account) => {
        const hasChildren = (childrenByParentId.get(account.id) ?? []).some(
          (child) => child.type === type
        );
        const totals = hasChildren
          ? rolledUpTotals.get(account.id)!
          : totalsByAccountId.get(account.id)!;
        return sum.plus(totals.balance);
      },
      new PrismaNamespace.Decimal(0)
    );

    return { groups, total };
  };

  const revenue = buildSection("REVENUE");
  const expenses = buildSection("EXPENSE");
  const netProfit = revenue.total.minus(expenses.total);

  return {
    revenue: { groups: revenue.groups, total: serializeAmount(revenue.total) },
    expenses: { groups: expenses.groups, total: serializeAmount(expenses.total) },
    totalRevenue: serializeAmount(revenue.total),
    totalExpense: serializeAmount(expenses.total),
    netProfit: serializeAmount(netProfit),
  };
}
