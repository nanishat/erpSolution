import type { AccountType, AccountSubType, Prisma } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { db } from "@/lib/db";
import {
  reportDateExclusiveEnd,
  reportFiltersSchema,
  REPORTABLE_JOURNAL_ENTRY_WHERE,
  type GeneralLedgerQuery,
} from "@/modules/accounting/services/report-utils";

const CASH_BANK_SUBTYPES: AccountSubType[] = ["CASH", "BANK"];
const CASH_FLOW_CATEGORIES = ["operating", "investing", "financing"] as const;

export type CashFlowCategory = (typeof CASH_FLOW_CATEGORIES)[number];

export type CashFlowRow = {
  accountId: string;
  code: string;
  name: string;
  netCashEffect: number;
};

export type CashFlowSection = {
  rows: CashFlowRow[];
  total: number;
};

export type CashFlowResult = {
  opening: number;
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  netChange: number;
  closing: number;
  reconciles: boolean;
  difference: number;
};

type CounterpartAccount = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subType: AccountSubType | null;
};

function serializeAmount(amount: PrismaNamespace.Decimal): number {
  return Number(amount.toFixed(2));
}

function startOfDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function reportToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Classify cash-flow activity from its non-cash counterpart account.
function classifyCashFlowCategory(account: CounterpartAccount): CashFlowCategory {
  if (account.subType === "FIXED_ASSET") return "investing";
  if (account.subType === "LONG_TERM_LIABILITY" || account.type === "EQUITY") {
    return "financing";
  }
  return "operating";
}

async function getCashBalance(asOfExclusive: Date): Promise<PrismaNamespace.Decimal> {
  const totals = await db.journalLine.aggregate({
    where: {
      account: { subType: { in: CASH_BANK_SUBTYPES } },
      journalEntry: {
        ...REPORTABLE_JOURNAL_ENTRY_WHERE,
        date: { lt: asOfExclusive },
      },
    },
    _sum: { debit: true, credit: true },
  });
  return (totals._sum.debit ?? new PrismaNamespace.Decimal(0)).minus(
    totals._sum.credit ?? new PrismaNamespace.Decimal(0)
  );
}

export async function getCashFlow(
  query: Pick<GeneralLedgerQuery, "from" | "to">
): Promise<CashFlowResult> {
  const filters = reportFiltersSchema.parse(query);
  const to = filters.to ?? reportToday();
  const periodDate: Prisma.DateTimeFilter = {
    lt: reportDateExclusiveEnd(to),
  };
  if (filters.from) periodDate.gte = startOfDate(filters.from);

  const zero = () => new PrismaNamespace.Decimal(0);
  const totalsByAccount = new Map<
    string,
    { account: CounterpartAccount; amount: PrismaNamespace.Decimal }
  >();
  const totalsByCategory: Record<CashFlowCategory, PrismaNamespace.Decimal> = {
    operating: zero(),
    investing: zero(),
    financing: zero(),
  };

  const [opening, counterpartLines] = await Promise.all([
    filters.from
      ? getCashBalance(startOfDate(filters.from))
      : Promise.resolve(zero()),
    db.journalLine.findMany({
      where: {
        OR: [
          { account: { subType: null } },
          { account: { subType: { notIn: CASH_BANK_SUBTYPES } } },
        ],
        journalEntry: {
          ...REPORTABLE_JOURNAL_ENTRY_WHERE,
          date: periodDate,
          lines: {
            some: {
              account: { subType: { in: CASH_BANK_SUBTYPES } },
            },
          },
        },
      },
      select: {
        debit: true,
        credit: true,
        account: {
          select: { id: true, code: true, name: true, type: true, subType: true },
        },
      },
    }),
  ]);

  for (const line of counterpartLines) {
    const category = classifyCashFlowCategory(line.account);
    const amount = line.credit.minus(line.debit);
    const previous = totalsByAccount.get(line.account.id);
    if (previous) {
      previous.amount = previous.amount.plus(amount);
    } else {
      totalsByAccount.set(line.account.id, { account: line.account, amount });
    }
    totalsByCategory[category] = totalsByCategory[category].plus(amount);
  }

  const sections = Object.fromEntries(
    CASH_FLOW_CATEGORIES.map((category) => [
      category,
      {
        rows: [...totalsByAccount.values()]
          .filter(
            ({ account, amount }) =>
              classifyCashFlowCategory(account) === category && !amount.isZero()
          )
          .sort((left, right) => left.account.code.localeCompare(right.account.code))
          .map(({ account, amount }) => ({
            accountId: account.id,
            code: account.code,
            name: account.name,
            netCashEffect: serializeAmount(amount),
          })),
        total: serializeAmount(totalsByCategory[category]),
      },
    ])
  ) as Record<CashFlowCategory, CashFlowSection>;

  const netChange = CASH_FLOW_CATEGORIES.reduce(
    (sum, category) => sum.plus(totalsByCategory[category]),
    zero()
  );
  const closing = opening.plus(netChange);
  const directClosing = await getCashBalance(reportDateExclusiveEnd(to));
  const difference = closing.minus(directClosing);

  return {
    opening: serializeAmount(opening),
    operating: sections.operating,
    investing: sections.investing,
    financing: sections.financing,
    netChange: serializeAmount(netChange),
    closing: serializeAmount(closing),
    reconciles: difference.isZero(),
    difference: serializeAmount(difference),
  };
}
