import type { AccountType, JournalEntryStatus, Prisma, VoucherType } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { db } from "@/lib/db";
import { ChartOfAccountNotFoundError } from "@/modules/accounting/services/chart-of-account.service";
import {
  getNormalBalance,
  REPORTABLE_JOURNAL_ENTRY_WHERE,
  type GeneralLedgerQuery,
} from "@/modules/accounting/services/report-utils";

type GeneralLedgerAccount = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
};

export type GeneralLedgerLine = {
  lineId: string;
  journalEntryId: string;
  documentNumber: string;
  voucherType: VoucherType;
  status: JournalEntryStatus;
  date: Date;
  description: string;
  memo: string | null;
  branchName: string;
  debit: number;
  credit: number;
  runningBalance: number;
};

export type GeneralLedgerSection = {
  account: GeneralLedgerAccount;
  openingBalance: number;
  lines: GeneralLedgerLine[];
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
};

export type GeneralLedgerResult = {
  sections: GeneralLedgerSection[];
};

export type GeneralLedgerAccountOption = {
  id: string;
  code: string;
  name: string;
  isPostable: boolean;
};

type RawLedgerLine = Prisma.JournalLineGetPayload<{
  select: {
    id: true;
    accountId: true;
    debit: true;
    credit: true;
    memo: true;
    branch: { select: { name: true } };
    journalEntry: {
      select: {
        id: true;
        documentNumber: true;
        voucherType: true;
        status: true;
        date: true;
        description: true;
      };
    };
  };
}>;

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

function makeEntryWhere(
  query: GeneralLedgerQuery,
  range: "opening" | "period"
): Prisma.JournalEntryWhereInput {
  const date: Prisma.DateTimeFilter = {};
  if (range === "opening" && query.from) {
    date.lt = startOfDate(query.from);
  } else {
    if (query.from) date.gte = startOfDate(query.from);
    if (query.to) date.lt = nextDate(startOfDate(query.to));
  }

  return {
    ...REPORTABLE_JOURNAL_ENTRY_WHERE,
    ...(Object.keys(date).length > 0 ? { date } : {}),
  };
}

function lineWhere(
  query: GeneralLedgerQuery,
  accountIds: string[],
  range: "opening" | "period"
): Prisma.JournalLineWhereInput {
  return {
    accountId: { in: accountIds },
    branchId: query.branchId,
    journalEntry: makeEntryWhere(query, range),
  };
}

export async function getGeneralLedger(
  query: GeneralLedgerQuery
): Promise<GeneralLedgerResult> {
  let accounts: GeneralLedgerAccount[];
  if (query.accountId) {
    const selected = await db.chartOfAccount.findUnique({
      where: { id: query.accountId },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        children: {
          orderBy: { code: "asc" },
          select: { id: true, code: true, name: true, type: true },
        },
      },
    });
    if (!selected) throw new ChartOfAccountNotFoundError(query.accountId);
    accounts =
      selected.children.length > 0
        ? selected.children
        : [{ id: selected.id, code: selected.code, name: selected.name, type: selected.type }];
  } else {
    accounts = await db.chartOfAccount.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true },
    });
  }

  const accountIds = accounts.map((account) => account.id);
  if (accountIds.length === 0) return { sections: [] };

  const lineSelect = {
    id: true,
    accountId: true,
    debit: true,
    credit: true,
    memo: true,
    branch: { select: { name: true } },
    journalEntry: {
      select: {
        id: true,
        documentNumber: true,
        voucherType: true,
        status: true,
        date: true,
        description: true,
      },
    },
  } satisfies Prisma.JournalLineSelect;

  const [openingLines, periodLines] = await Promise.all([
    query.from
      ? db.journalLine.findMany({
          where: lineWhere(query, accountIds, "opening"),
          select: lineSelect,
        })
      : Promise.resolve([] as RawLedgerLine[]),
    db.journalLine.findMany({
      where: lineWhere(query, accountIds, "period"),
      orderBy: [
        { journalEntry: { date: "asc" } },
        { journalEntry: { documentNumber: "asc" } },
        { id: "asc" },
      ],
      select: lineSelect,
    }),
  ]);
  const openingByAccount = new Map<
    string,
    { debit: PrismaNamespace.Decimal; credit: PrismaNamespace.Decimal }
  >();
  for (const line of openingLines) {
    const previous = openingByAccount.get(line.accountId) ?? {
      debit: new PrismaNamespace.Decimal(0),
      credit: new PrismaNamespace.Decimal(0),
    };
    openingByAccount.set(line.accountId, {
      debit: previous.debit.plus(line.debit),
      credit: previous.credit.plus(line.credit),
    });
  }

  const periodLinesByAccount = new Map<string, RawLedgerLine[]>();
  for (const line of periodLines) {
    const lines = periodLinesByAccount.get(line.accountId) ?? [];
    lines.push(line);
    periodLinesByAccount.set(line.accountId, lines);
  }

  const sections = accounts.map((account) => {
    const openingTotals = openingByAccount.get(account.id) ?? {
      debit: new PrismaNamespace.Decimal(0),
      credit: new PrismaNamespace.Decimal(0),
    };
    const openingBalance = query.from
      ? getNormalBalance(account.type, openingTotals.debit, openingTotals.credit)
      : new PrismaNamespace.Decimal(0);
    let runningBalance = openingBalance;
    let periodDebit = new PrismaNamespace.Decimal(0);
    let periodCredit = new PrismaNamespace.Decimal(0);

    const lines = (periodLinesByAccount.get(account.id) ?? []).map((line) => {
      periodDebit = periodDebit.plus(line.debit);
      periodCredit = periodCredit.plus(line.credit);
      runningBalance = runningBalance.plus(
        getNormalBalance(account.type, line.debit, line.credit)
      );

      return {
        lineId: line.id,
        journalEntryId: line.journalEntry.id,
        documentNumber: line.journalEntry.documentNumber,
        voucherType: line.journalEntry.voucherType,
        status: line.journalEntry.status,
        date: line.journalEntry.date,
        description: line.journalEntry.description,
        memo: line.memo,
        branchName: line.branch.name,
        debit: serializeAmount(line.debit),
        credit: serializeAmount(line.credit),
        runningBalance: serializeAmount(runningBalance),
      };
    });

    return {
      account,
      openingBalance: serializeAmount(openingBalance),
      lines,
      periodDebit: serializeAmount(periodDebit),
      periodCredit: serializeAmount(periodCredit),
      closingBalance: serializeAmount(runningBalance),
    };
  });

  if (query.accountId) return { sections };
  return {
    sections: sections.filter(
      (section) => section.openingBalance !== 0 || section.lines.length > 0
    ),
  };
}

export async function getGeneralLedgerAccountOptions(): Promise<
  GeneralLedgerAccountOption[]
> {
  return db.chartOfAccount.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, isPostable: true },
  });
}
