import { db } from "@/lib/db";
import { getProfitAndLoss } from "@/modules/accounting/services/profit-and-loss.service";
import type { ProfitAndLossGroup, ProfitAndLossResult } from "@/modules/accounting/services/profit-and-loss.service";

export type DashboardPeriod = "this-month" | "last-month" | "this-fy";

type DateRange = {
  from: Date;
  toExclusive: Date;
};

type MonthBucket = {
  label: string;
  from: Date;
  toExclusive: Date;
};

export type DashboardMonth = {
  label: string;
  primary: number;
  secondary?: number;
};

export type DashboardValue = {
  label: string;
  primary: number;
};

function getDateRange(period: DashboardPeriod, now: Date): DateRange {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  if (period === "this-month") {
    return {
      from: new Date(Date.UTC(year, month, 1)),
      toExclusive: new Date(Date.UTC(year, month + 1, 1)),
    };
  }

  if (period === "last-month") {
    return {
      from: new Date(Date.UTC(year, month - 1, 1)),
      toExclusive: new Date(Date.UTC(year, month, 1)),
    };
  }

  const fiscalYearStart = month >= 6 ? year : year - 1;
  return {
    from: new Date(Date.UTC(fiscalYearStart, 6, 1)),
    toExclusive: new Date(Date.UTC(fiscalYearStart + 1, 6, 1)),
  };
}

function getPreviousDateRange(period: DashboardPeriod, now: Date): DateRange {
  if (period === "this-month") {
    const previousMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
    );
    return {
      from: previousMonth,
      toExclusive: new Date(
        Date.UTC(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth() + 1, 1)
      ),
    };
  }

  if (period === "last-month") {
    const previousMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)
    );
    return {
      from: previousMonth,
      toExclusive: new Date(
        Date.UTC(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth() + 1, 1)
      ),
    };
  }

  const current = getDateRange(period, now);
  const from = new Date(current.from);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  const toExclusive = new Date(current.toExclusive);
  toExclusive.setUTCFullYear(toExclusive.getUTCFullYear() - 1);
  return { from, toExclusive };
}

function getMonthBuckets(now: Date, count: number): MonthBucket[] {
  return Array.from({ length: count }, (_, index) => {
    const monthOffset = index - count + 1;
    const from = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1)
    );
    return {
      label: from.toLocaleDateString("en-US", {
        month: "short",
        timeZone: "UTC",
      }),
      from,
      toExclusive: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1)),
    };
  });
}

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function decimalToNumber(value: { toNumber(): number } | null | undefined): number {
  return value?.toNumber() ?? 0;
}

async function getFinancialSummary(
  range: DateRange,
  branchId?: string,
  bySector = false
) {
  return getProfitAndLoss({
    from: dateString(range.from),
    to: dateString(new Date(range.toExclusive.getTime() - 86_400_000)),
    branchId,
    bySector,
  });
}

async function getIncomeExpenseByMonth(
  buckets: MonthBucket[],
  branchId?: string
): Promise<DashboardMonth[]> {
  const reports = await Promise.all(
    buckets.map((bucket) =>
      getProfitAndLoss({
        from: dateString(bucket.from),
        to: dateString(new Date(bucket.toExclusive.getTime() - 86_400_000)),
        branchId,
      })
    )
  );

  return buckets.map((bucket, index) => ({
    label: bucket.label,
    primary: reports[index].totalRevenue,
    secondary: reports[index].totalExpense,
  }));
}

async function getInvoicedByMonth(
  buckets: MonthBucket[],
  branchId?: string
): Promise<DashboardMonth[]> {
  const firstBucket = buckets[0];
  const lastBucket = buckets[buckets.length - 1];
  const invoices = await db.invoice.findMany({
    where: {
      direction: "CUSTOMER",
      status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] },
      date: { gte: firstBucket.from, lt: lastBucket.toExclusive },
      ...(branchId ? { branchId } : {}),
    },
    select: { date: true, grandTotal: true },
  });
  const totalsByMonth = new Map(
    buckets.map((bucket) => [
      `${bucket.from.getUTCFullYear()}-${bucket.from.getUTCMonth()}`,
      0,
    ])
  );

  for (const invoice of invoices) {
    const key = `${invoice.date.getUTCFullYear()}-${invoice.date.getUTCMonth()}`;
    totalsByMonth.set(
      key,
      (totalsByMonth.get(key) ?? 0) + invoice.grandTotal.toNumber()
    );
  }

  return buckets.map((bucket) => ({
    label: bucket.label,
    primary:
      totalsByMonth.get(
        `${bucket.from.getUTCFullYear()}-${bucket.from.getUTCMonth()}`
      ) ?? 0,
  }));
}

async function getCollectedByMonth(
  buckets: MonthBucket[],
  branchId?: string
): Promise<DashboardMonth[]> {
  const payments = await db.payment.findMany({
    where: {
      partner: { type: "CUSTOMER" },
      date: { gte: buckets[0].from, lt: buckets[buckets.length - 1].toExclusive },
      ...(branchId ? { journalEntry: { branchId } } : {}),
    },
    select: { date: true, amount: true },
  });
  const totalsByMonth = new Map(
    buckets.map((bucket) => [
      `${bucket.from.getUTCFullYear()}-${bucket.from.getUTCMonth()}`,
      0,
    ])
  );

  for (const payment of payments) {
    const key = `${payment.date.getUTCFullYear()}-${payment.date.getUTCMonth()}`;
    totalsByMonth.set(
      key,
      (totalsByMonth.get(key) ?? 0) + payment.amount.toNumber()
    );
  }

  return buckets.map((bucket) => ({
    label: bucket.label,
    primary: 0,
    secondary:
      totalsByMonth.get(
        `${bucket.from.getUTCFullYear()}-${bucket.from.getUTCMonth()}`
      ) ?? 0,
  }));
}

async function getCollectedTotal(range: DateRange, branchId?: string) {
  const result = await db.payment.aggregate({
    where: {
      partner: { type: "CUSTOMER" },
      date: { gte: range.from, lt: range.toExclusive },
      ...(branchId ? { journalEntry: { branchId } } : {}),
    },
    _sum: { amount: true },
  });
  return decimalToNumber(result._sum.amount);
}

function getIncomeBySector(report: ProfitAndLossResult): DashboardValue[] {
  const labels: Record<string, string> = {
    GS: "Guard Service",
    CC: "Cash Carrying",
    EQ: "Equipment",
    MS: "Miscellaneous",
    UNASSIGNED: "Unassigned",
  };
  const totals = new Map<string, number>();
  for (const [sector, amount] of Object.entries(
    report.revenue.sectorAmounts ?? {}
  )) {
    const label = labels[sector] ?? "Other";
    totals.set(label, (totals.get(label) ?? 0) + amount);
  }
  return [...totals]
    .map(([label, primary]) => ({ label, primary }))
    .sort((left, right) => right.primary - left.primary);
}

function sumNonSystemLeaves(group: ProfitAndLossGroup): number {
  if (group.row.isSystem) return 0;
  if (group.children.length === 0) return group.row.amount;
  return group.children.reduce(
    (total, child) => total + sumNonSystemLeaves(child),
    0
  );
}

function getTopExpenseHeads(report: ProfitAndLossResult): DashboardValue[] {
  const heads = report.expenses.groups.flatMap((root) =>
    root.children.length > 0 ? root.children : [root]
  );
  return heads
    .filter((head) => !head.row.isSystem)
    .map((head) => ({
      label: head.row.name,
      primary: sumNonSystemLeaves(head),
    }))
    .sort((left, right) => right.primary - left.primary)
    .slice(0, 5);
}

async function getSalesMetrics(
  now: Date,
  branchId?: string
) {
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const [receivables, overdueInvoices] = await Promise.all([
    db.partner.aggregate({
      where: { type: "CUSTOMER" },
      _sum: { outstandingBalance: true },
    }),
    db.invoice.count({
      where: {
        direction: "CUSTOMER",
        status: { in: ["POSTED", "PARTIALLY_PAID"] },
        dueDate: { lt: startOfToday },
        ...(branchId ? { branchId } : {}),
      },
    }),
  ]);

  return {
    receivables: decimalToNumber(receivables._sum.outstandingBalance),
    overdueInvoices,
  };
}

async function getPayables() {
  const payables = await db.partner.aggregate({
    where: { type: "VENDOR" },
    _sum: { payableBalance: true },
  });
  return decimalToNumber(payables._sum.payableBalance);
}

async function getVoucherMetrics(
  range: DateRange,
  branchId?: string
) {
  const draftCount = await db.journalEntry.count({
    where: {
      date: { gte: range.from, lt: range.toExclusive },
      status: "DRAFT",
      ...(branchId ? { branchId } : {}),
      invoice: null,
    },
  });
  return { draftCount };
}

async function getBankingMetrics() {
  const unmatchedLines = await db.bankStatementLine.count({
    where: { matchStatus: "UNMATCHED" },
  });
  return { unmatchedLines };
}

export async function getDashboardData({
  period,
  branchId,
}: {
  period: DashboardPeriod;
  branchId?: string;
}) {
  const now = new Date();
  const range = getDateRange(period, now);
  const previousRange = getPreviousDateRange(period, now);
  const buckets = getMonthBuckets(now, 6);
  const [
    financialSummary,
    previousFinancialSummary,
    sectorSummary,
    incomeExpenseByMonth,
    invoicedByMonth,
    collectedByMonth,
    collected,
    sales,
    payables,
    vouchers,
    banking,
  ] = await Promise.all([
    getFinancialSummary(range, branchId),
    getFinancialSummary(previousRange, branchId),
    getFinancialSummary(range, branchId, true),
    getIncomeExpenseByMonth(buckets, branchId),
    getInvoicedByMonth(buckets, branchId),
    getCollectedByMonth(buckets, branchId),
    getCollectedTotal(range, branchId),
    getSalesMetrics(now, branchId),
    getPayables(),
    getVoucherMetrics(range, branchId),
    getBankingMetrics(),
  ]);

  return {
    income: financialSummary.totalRevenue,
    expense: financialSummary.totalExpense,
    net: financialSummary.netProfit,
    previousIncome: previousFinancialSummary.totalRevenue,
    previousExpense: previousFinancialSummary.totalExpense,
    previousNet: previousFinancialSummary.netProfit,
    collected,
    incomeBySector: getIncomeBySector(sectorSummary),
    topExpenseHeads: getTopExpenseHeads(financialSummary),
    incomeExpenseByMonth,
    invoicedByMonth,
    collectedByMonth,
    sales,
    payables,
    vouchers,
    banking,
  };
}
