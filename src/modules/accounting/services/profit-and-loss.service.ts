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

export const UNASSIGNED_SECTOR = "UNASSIGNED";

export type SectorAmountMap = Record<string, number>;

export type ProfitAndLossRow = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  amount: number;
  sectorAmounts?: SectorAmountMap;
};

export type ProfitAndLossGroup = {
  row: ProfitAndLossRow;
  children: ProfitAndLossGroup[];
};

type ProfitAndLossSection = {
  groups: ProfitAndLossGroup[];
  total: number;
  sectorAmounts?: SectorAmountMap;
};

export type ProfitAndLossResult = {
  revenue: ProfitAndLossSection;
  expenses: ProfitAndLossSection;
  totalRevenue: number;
  totalExpense: number;
  netProfit: number;
  sectors?: string[];
  sectorTotalsReconcile?: boolean;
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
  query: Pick<GeneralLedgerQuery, "from" | "to" | "branchId"> & {
    bySector?: boolean;
  }
): Promise<ProfitAndLossResult> {
  const filters = reportFiltersSchema.parse(query);
  const bySector = query.bySector ?? false;

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

  const activityWhere: Prisma.JournalLineWhereInput = {
    accountId: { in: accounts.map((account) => account.id) },
    branchId: filters.branchId,
    journalEntry: {
      ...REPORTABLE_JOURNAL_ENTRY_WHERE,
      ...(Object.keys(date).length > 0 ? { date } : {}),
    },
  };
  const activity = accounts.length
    ? await db.journalLine.groupBy({
        by: ["accountId"],
        where: activityWhere,
        _sum: { debit: true, credit: true },
      })
    : [];

  const sectorAmountsByAccountId = new Map<
    string,
    Map<string, { debit: PrismaNamespace.Decimal; credit: PrismaNamespace.Decimal }>
  >();
  const sectorSet = new Set<string>([UNASSIGNED_SECTOR]);
  if (bySector && accounts.length > 0) {
    const sectorLines = await db.journalLine.findMany({
      where: activityWhere,
      select: {
        accountId: true,
        debit: true,
        credit: true,
        journalEntry: {
          select: {
            sector: true,
            invoice: { select: { sector: true } },
            reversalOfEntry: {
              select: {
                sector: true,
                invoice: { select: { sector: true } },
              },
            },
          },
        },
      },
    });

    for (const line of sectorLines) {
      const sector =
        line.journalEntry.sector ??
        line.journalEntry.invoice?.sector ??
        line.journalEntry.reversalOfEntry?.sector ??
        line.journalEntry.reversalOfEntry?.invoice?.sector ??
        UNASSIGNED_SECTOR;
      sectorSet.add(sector);

      let accountSectors = sectorAmountsByAccountId.get(line.accountId);
      if (!accountSectors) {
        accountSectors = new Map();
        sectorAmountsByAccountId.set(line.accountId, accountSectors);
      }
      let totals = accountSectors.get(sector);
      if (!totals) {
        totals = {
          debit: new PrismaNamespace.Decimal(0),
          credit: new PrismaNamespace.Decimal(0),
        };
        accountSectors.set(sector, totals);
      }
      totals.debit = totals.debit.plus(line.debit);
      totals.credit = totals.credit.plus(line.credit);
    }
  }
  const sectors = [
    ...[...sectorSet].filter((sector) => sector !== UNASSIGNED_SECTOR).sort(),
    UNASSIGNED_SECTOR,
  ];

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
  let sectorTotalsReconcile = true;

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
    const sectorRolledUpTotals = new Map<
      string,
      Map<string, AccountReportTotals>
    >();
    if (bySector) {
      for (const sector of sectors) {
        const sectorTotalsByAccountId = new Map<string, AccountReportTotals>();
        for (const account of sectionAccounts) {
          const sums = sectorAmountsByAccountId.get(account.id)?.get(sector) ?? {
            debit: new PrismaNamespace.Decimal(0),
            credit: new PrismaNamespace.Decimal(0),
          };
          sectorTotalsByAccountId.set(account.id, {
            ...sums,
            balance: getNormalBalance(account.type, sums.debit, sums.credit),
          });
        }
        sectorRolledUpTotals.set(
          sector,
          rollupHeaderTotals(
            [...sectionAccounts].sort(
              (left, right) => depthOf(right) - depthOf(left)
            ),
            sectorTotalsByAccountId
          )
        );
      }
    }

    const sectorAmountsFor = (
      accountId: string,
      expectedBalance: PrismaNamespace.Decimal
    ): SectorAmountMap | undefined => {
      if (!bySector) return undefined;
      const amounts = sectors.map((sector) => {
        const amount =
          sectorRolledUpTotals.get(sector)?.get(accountId)?.balance ??
          new PrismaNamespace.Decimal(0);
        return [sector, serializeAmount(amount)] as const;
      });
      const amountSum = amounts.reduce(
        (sum, [, amount]) => sum.plus(new PrismaNamespace.Decimal(amount)),
        new PrismaNamespace.Decimal(0)
      );
      if (
        !amountSum.equals(new PrismaNamespace.Decimal(serializeAmount(expectedBalance)))
      ) {
        sectorTotalsReconcile = false;
      }
      return Object.fromEntries(amounts);
    };

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

      const sectorAmounts = sectorAmountsFor(account.id, totals.balance);
      return {
        row: {
          accountId: account.id,
          code: account.code,
          name: account.name,
          type: account.type,
          amount: serializeAmount(totals.balance),
          ...(sectorAmounts ? { sectorAmounts } : {}),
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

    const sectorTotalAmounts = bySector
      ? Object.fromEntries(
          sectors.map((sector) => {
            const total = rootAccounts.reduce((sum, account) => {
              const accountTotals = sectorRolledUpTotals.get(sector)?.get(account.id);
              return sum.plus(accountTotals?.balance ?? new PrismaNamespace.Decimal(0));
            }, new PrismaNamespace.Decimal(0));
            return [sector, serializeAmount(total)];
          })
        )
      : undefined;
    if (sectorTotalAmounts) {
      const sectorTotalSum = Object.values(sectorTotalAmounts).reduce(
        (sum, amount) => sum.plus(new PrismaNamespace.Decimal(amount)),
        new PrismaNamespace.Decimal(0)
      );
      if (!sectorTotalSum.equals(new PrismaNamespace.Decimal(serializeAmount(total)))) {
        sectorTotalsReconcile = false;
      }
    }

    return {
      groups,
      total,
      ...(sectorTotalAmounts ? { sectorAmounts: sectorTotalAmounts } : {}),
    };
  };

  const revenue = buildSection("REVENUE");
  const expenses = buildSection("EXPENSE");
  const netProfit = revenue.total.minus(expenses.total);

  const result: ProfitAndLossResult = {
    revenue: {
      groups: revenue.groups,
      total: serializeAmount(revenue.total),
      ...(revenue.sectorAmounts ? { sectorAmounts: revenue.sectorAmounts } : {}),
    },
    expenses: {
      groups: expenses.groups,
      total: serializeAmount(expenses.total),
      ...(expenses.sectorAmounts ? { sectorAmounts: expenses.sectorAmounts } : {}),
    },
    totalRevenue: serializeAmount(revenue.total),
    totalExpense: serializeAmount(expenses.total),
    netProfit: serializeAmount(netProfit),
  };
  if (bySector) {
    return {
      ...result,
      sectors,
      sectorTotalsReconcile,
    };
  }
  return result;
}
