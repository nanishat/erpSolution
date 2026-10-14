import type { AccountType, Prisma } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { db } from "@/lib/db";
import {
  balanceSheetQuerySchema,
  getNormalBalance,
  REPORTABLE_JOURNAL_ENTRY_WHERE,
  reportDateExclusiveEnd,
  rollupHeaderTotals,
  type AccountReportTotals,
  type BalanceSheetQuery,
} from "@/modules/accounting/services/report-utils";

export type BalanceSheetRow = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  amount: number;
};

export type BalanceSheetGroup = {
  row: BalanceSheetRow;
  children: BalanceSheetGroup[];
};

export type BalanceSheetSection = {
  groups: BalanceSheetGroup[];
  total: number;
};

type BuiltBalanceSheetSection = {
  groups: BalanceSheetGroup[];
  total: PrismaNamespace.Decimal;
};

export type BalanceSheetResult = {
  asOf: string;
  assets: BalanceSheetSection;
  liabilities: BalanceSheetSection;
  equity: BalanceSheetSection;
  totalAssets: number;
  totalLiabilities: number;
  totalEquityAccounts: number;
  currentProfit: number;
  totalEquity: number;
  balanced: boolean;
  difference: number | null;
};

type BalanceSheetAccount = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
};

function serializeAmount(amount: PrismaNamespace.Decimal): number {
  return Number(amount.toFixed(2));
}

function serverDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function accountDepth(
  account: BalanceSheetAccount,
  accountsById: ReadonlyMap<string, BalanceSheetAccount>
): number {
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
}

export async function getBalanceSheet(
  query: BalanceSheetQuery = {}
): Promise<BalanceSheetResult> {
  const filters = balanceSheetQuerySchema.parse(query);
  const asOf = filters.asOf ?? serverDate();
  const accounts = await db.chartOfAccount.findMany({
    where: {
      type: { in: ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] },
    },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, type: true, parentId: true },
  });

  const activity = accounts.length
    ? await db.journalLine.groupBy({
        by: ["accountId"],
        where: {
          accountId: { in: accounts.map((account) => account.id) },
          journalEntry: {
            ...REPORTABLE_JOURNAL_ENTRY_WHERE,
            date: { lt: reportDateExclusiveEnd(asOf) },
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
  const childrenByParentId = new Map<string, BalanceSheetAccount[]>();
  for (const account of accounts) {
    if (!account.parentId) continue;
    const children = childrenByParentId.get(account.parentId) ?? [];
    children.push(account);
    childrenByParentId.set(account.parentId, children);
  }

  const buildSection = (type: AccountType): BuiltBalanceSheetSection => {
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
      [...sectionAccounts].sort(
        (left, right) =>
          accountDepth(right, accountsById) - accountDepth(left, accountsById)
      ),
      totalsByAccountId
    );

    const makeGroups = (accountId: string): BalanceSheetGroup[] => {
      const account = accountsById.get(accountId)!;
      const childAccounts = (childrenByParentId.get(accountId) ?? []).filter(
        (child) => child.type === type
      );
      const children = childAccounts.flatMap((child) => makeGroups(child.id));
      const totals =
        childAccounts.length > 0
          ? rolledUpTotals.get(accountId)!
          : totalsByAccountId.get(accountId)!;

      if (totals.balance.isZero()) return children;

      return [
        {
          row: {
            accountId: account.id,
            code: account.code,
            name: account.name,
            type: account.type,
            amount: serializeAmount(totals.balance),
          },
          children,
        },
      ];
    };

    const rootAccounts = sectionAccounts.filter(
      (account) =>
        !account.parentId ||
        !accountsById.has(account.parentId) ||
        accountsById.get(account.parentId)?.type !== type
    );
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

    return {
      groups: rootAccounts.flatMap((account) => makeGroups(account.id)),
      total,
    };
  };

  const assetsTotals = buildSection("ASSET");
  const liabilitiesTotals = buildSection("LIABILITY");
  const equityTotals = buildSection("EQUITY");
  const revenue = buildSection("REVENUE");
  const expenses = buildSection("EXPENSE");
  const totalAssets = assetsTotals.total;
  const totalLiabilities = liabilitiesTotals.total;
  const totalEquityAccounts = equityTotals.total;
  const currentProfit = revenue.total.minus(expenses.total);
  const totalEquity = totalEquityAccounts.plus(currentProfit);
  const difference = totalAssets.minus(totalLiabilities).minus(totalEquity);
  const balanced = difference.isZero();

  return {
    asOf,
    assets: {
      groups: assetsTotals.groups,
      total: serializeAmount(assetsTotals.total),
    },
    liabilities: {
      groups: liabilitiesTotals.groups,
      total: serializeAmount(liabilitiesTotals.total),
    },
    equity: {
      groups: equityTotals.groups,
      total: serializeAmount(equityTotals.total),
    },
    totalAssets: serializeAmount(totalAssets),
    totalLiabilities: serializeAmount(totalLiabilities),
    totalEquityAccounts: serializeAmount(totalEquityAccounts),
    currentProfit: serializeAmount(currentProfit),
    totalEquity: serializeAmount(totalEquity),
    balanced,
    difference: balanced ? null : serializeAmount(difference),
  };
}
