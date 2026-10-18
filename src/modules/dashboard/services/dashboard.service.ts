import { db } from "@/lib/db";
import { getProfitAndLoss } from "@/modules/accounting/services/profit-and-loss.service";

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

export type DashboardStatusCount = {
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

async function getFinancialSummary(range: DateRange, branchId?: string) {
  return getProfitAndLoss({
    from: dateString(range.from),
    to: dateString(new Date(range.toExclusive.getTime() - 86_400_000)),
    branchId,
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
  direction: "CUSTOMER" | "VENDOR",
  buckets: MonthBucket[],
  branchId?: string
): Promise<DashboardMonth[]> {
  const firstBucket = buckets[0];
  const lastBucket = buckets[buckets.length - 1];
  const invoices = await db.invoice.findMany({
    where: {
      direction,
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

async function getSalesMetrics(
  buckets: MonthBucket[],
  now: Date,
  branchId?: string
) {
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const [receivables, overdueInvoices, invoicedByMonth] = await Promise.all([
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
    getInvoicedByMonth("CUSTOMER", buckets, branchId),
  ]);

  return {
    receivables: decimalToNumber(receivables._sum.outstandingBalance),
    overdueInvoices,
    invoicedByMonth,
  };
}

async function getPurchaseMetrics(
  buckets: MonthBucket[],
  branchId?: string
) {
  const [payables, unpaidBills, billedByMonth] = await Promise.all([
    db.partner.aggregate({
      where: { type: "VENDOR" },
      _sum: { payableBalance: true },
    }),
    db.invoice.count({
      where: {
        direction: "VENDOR",
        status: { in: ["POSTED", "PARTIALLY_PAID"] },
        ...(branchId ? { branchId } : {}),
      },
    }),
    getInvoicedByMonth("VENDOR", buckets, branchId),
  ]);

  return {
    payables: decimalToNumber(payables._sum.payableBalance),
    unpaidBills,
    billedByMonth,
  };
}

async function getVoucherMetrics(
  range: DateRange,
  branchId?: string
) {
  const counts = await db.journalEntry.groupBy({
    by: ["status"],
    where: {
      date: { gte: range.from, lt: range.toExclusive },
      ...(branchId ? { branchId } : {}),
      invoice: null,
    },
    _count: { _all: true },
  });
  const countByStatus = new Map(
    counts.map((item) => [item.status, item._count._all])
  );

  return {
    draftCount: countByStatus.get("DRAFT") ?? 0,
    statusCounts: (["DRAFT", "POSTED", "VOID"] as const).map((status) => ({
      label: status,
      primary: countByStatus.get(status) ?? 0,
    })),
  };
}

async function getBankingMetrics() {
  const [unmatchedLines, counts] = await Promise.all([
    db.bankStatementLine.count({ where: { matchStatus: "UNMATCHED" } }),
    db.bankStatementLine.groupBy({
      by: ["matchStatus"],
      _count: { _all: true },
    }),
  ]);
  const countByStatus = new Map(
    counts.map((item) => [item.matchStatus, item._count._all])
  );

  return {
    unmatchedLines,
    statusCounts: (["UNMATCHED", "MATCHED", "IGNORED"] as const).map(
      (status) => ({
        label: status,
        primary: countByStatus.get(status) ?? 0,
      })
    ),
  };
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
  const buckets = getMonthBuckets(now, 6);
  const [
    financialSummary,
    incomeExpenseByMonth,
    sales,
    purchases,
    vouchers,
    banking,
  ] = await Promise.all([
    getFinancialSummary(range, branchId),
    getIncomeExpenseByMonth(buckets, branchId),
    getSalesMetrics(buckets, now, branchId),
    getPurchaseMetrics(buckets, branchId),
    getVoucherMetrics(range, branchId),
    getBankingMetrics(),
  ]);

  return {
    income: financialSummary.totalRevenue,
    expense: financialSummary.totalExpense,
    net: financialSummary.netProfit,
    incomeExpenseByMonth,
    sales,
    purchases,
    vouchers,
    banking,
  };
}
