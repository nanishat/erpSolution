import type { Prisma } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { db } from "@/lib/db";
import { reportDateExclusiveEnd, vatReportQuerySchema } from "@/modules/accounting/services/report-utils";

type VatReportQuery = {
  from?: string;
  to?: string;
};

type PartnerReportTotal = {
  partnerName: string;
  tin: string | null;
  bin: string | null;
  baseAmount: number;
  taxAmount: number;
};

type TaxReportRow = {
  date: string;
  journalEntryId: string;
  invoiceId: string | null;
  invoiceDirection: "CUSTOMER" | "VENDOR" | null;
  documentNumber: string;
  partnerName: string | null;
  tin: string | null;
  bin: string | null;
  baseAmount: number;
  ratePercent: number;
  taxAmount: number;
};

type TaxReportTotal = {
  baseAmount: number;
  taxAmount: number;
};

export type VatReportResult = {
  outputVat: {
    rows: TaxReportRow[];
    total: TaxReportTotal;
  };
  inputVat: {
    rows: TaxReportRow[];
    total: TaxReportTotal;
  };
  netVat: number;
  tds: {
    byMonth: ({ month: string } & TaxReportTotal)[];
    byPartner: PartnerReportTotal[];
    rows: TaxReportRow[];
    total: TaxReportTotal;
  };
  vds: {
    byMonth: ({ month: string } & TaxReportTotal)[];
    rows: TaxReportRow[];
    total: TaxReportTotal;
  };
};

const taxApplicationSelect = {
  taxType: true,
  direction: true,
  ratePercent: true,
  baseAmount: true,
  taxAmount: true,
  partner: {
    select: {
      id: true,
      name: true,
      tin: true,
      bin: true,
    },
  },
  journalEntry: {
    select: {
      id: true,
      date: true,
      documentNumber: true,
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          direction: true,
          partner: {
            select: {
              id: true,
              name: true,
              tin: true,
              bin: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.TaxApplicationSelect;

type TaxApplicationReportRecord = Prisma.TaxApplicationGetPayload<{
  select: typeof taxApplicationSelect;
}>;

type DecimalTotals = {
  baseAmount: PrismaNamespace.Decimal;
  taxAmount: PrismaNamespace.Decimal;
};

function zeroTotals(): DecimalTotals {
  return {
    baseAmount: new PrismaNamespace.Decimal(0),
    taxAmount: new PrismaNamespace.Decimal(0),
  };
}

function serializeAmount(amount: PrismaNamespace.Decimal): number {
  return Number(amount.toFixed(2));
}

function addTaxAmounts(totals: DecimalTotals, application: TaxApplicationReportRecord) {
  totals.baseAmount = totals.baseAmount.plus(application.baseAmount);
  totals.taxAmount = totals.taxAmount.plus(application.taxAmount);
}

function serializeTotals(totals: DecimalTotals): TaxReportTotal {
  return {
    baseAmount: serializeAmount(totals.baseAmount),
    taxAmount: serializeAmount(totals.taxAmount),
  };
}

// TaxPoint is the parent JournalEntry.date (invoice date for linked entries,
// voucher date otherwise); keep this choice centralized if the basis changes.
function taxPointDate(application: TaxApplicationReportRecord): Date {
  return application.journalEntry.date;
}

function mapTaxApplication(application: TaxApplicationReportRecord): TaxReportRow {
  const invoice = application.journalEntry.invoice;
  const partner = application.partner ?? invoice?.partner ?? null;
  return {
    date: taxPointDate(application).toISOString().slice(0, 10),
    journalEntryId: application.journalEntry.id,
    invoiceId: invoice?.id ?? null,
    invoiceDirection: invoice?.direction ?? null,
    documentNumber: invoice?.invoiceNumber ?? application.journalEntry.documentNumber,
    partnerName: partner?.name ?? null,
    tin: partner?.tin ?? null,
    bin: partner?.bin ?? null,
    baseAmount: serializeAmount(application.baseAmount),
    ratePercent: serializeAmount(application.ratePercent),
    taxAmount: serializeAmount(application.taxAmount),
  };
}

function compareTaxRows(left: TaxReportRow, right: TaxReportRow): number {
  return (
    left.date.localeCompare(right.date) ||
    left.documentNumber.localeCompare(right.documentNumber)
  );
}

function monthTotals(applications: TaxApplicationReportRecord[]) {
  const totalsByMonth = new Map<string, DecimalTotals>();
  for (const application of applications) {
    const month = taxPointDate(application).toISOString().slice(0, 7);
    const totals = totalsByMonth.get(month) ?? zeroTotals();
    addTaxAmounts(totals, application);
    totalsByMonth.set(month, totals);
  }
  return Array.from(totalsByMonth, ([month, totals]) => ({
    month,
    ...serializeTotals(totals),
  })).sort((left, right) => left.month.localeCompare(right.month));
}

function partnerTotals(applications: TaxApplicationReportRecord[]): PartnerReportTotal[] {
  const totalsByPartner = new Map<
    string,
    { partnerName: string; tin: string | null; bin: string | null; totals: DecimalTotals }
  >();
  for (const application of applications) {
    const partner = application.partner ?? application.journalEntry.invoice?.partner ?? null;
    const partnerId =
      partner?.id ?? `no-partner:${application.journalEntry.invoice?.id ?? "voucher"}`;
    const current = totalsByPartner.get(partnerId) ?? {
      partnerName: partner?.name ?? "No partner (voucher)",
      tin: partner?.tin ?? null,
      bin: partner?.bin ?? null,
      totals: zeroTotals(),
    };
    addTaxAmounts(current.totals, application);
    totalsByPartner.set(partnerId, current);
  }
  return Array.from(totalsByPartner.values())
    .map(({ partnerName, tin, bin, totals }) => ({
      partnerName,
      tin,
      bin,
      ...serializeTotals(totals),
    }))
    .sort((left, right) => left.partnerName.localeCompare(right.partnerName));
}

export async function getVatReport(query: VatReportQuery = {}): Promise<VatReportResult> {
  const filters = vatReportQuerySchema.parse(query);
  const date: Prisma.DateTimeFilter = {};
  if (filters.from) date.gte = new Date(`${filters.from}T00:00:00.000Z`);
  if (filters.to) date.lt = reportDateExclusiveEnd(filters.to);

  const applications = await db.taxApplication.findMany({
    where: {
      journalEntry: {
        status: "POSTED",
        ...(Object.keys(date).length > 0 ? { date } : {}),
      },
    },
    orderBy: [
      { journalEntry: { date: "asc" } },
      { journalEntry: { documentNumber: "asc" } },
      { id: "asc" },
    ],
    select: taxApplicationSelect,
  });

  const outputVatApps = applications.filter(
    (application) => application.taxType === "VAT" && application.direction === "OUTPUT"
  );
  const inputVatApps = applications.filter(
    (application) => application.taxType === "VAT" && application.direction === "INPUT"
  );
  const tdsApps = applications.filter((application) => application.taxType === "TDS");
  const vdsApps = applications.filter((application) => application.taxType === "VDS");
  const outputVatTotal = zeroTotals();
  const inputVatTotal = zeroTotals();
  const tdsTotal = zeroTotals();
  const vdsTotal = zeroTotals();
  for (const application of outputVatApps) addTaxAmounts(outputVatTotal, application);
  for (const application of inputVatApps) addTaxAmounts(inputVatTotal, application);
  for (const application of tdsApps) addTaxAmounts(tdsTotal, application);
  for (const application of vdsApps) addTaxAmounts(vdsTotal, application);

  return {
    outputVat: {
      rows: outputVatApps.map(mapTaxApplication).sort(compareTaxRows),
      total: serializeTotals(outputVatTotal),
    },
    inputVat: {
      rows: inputVatApps.map(mapTaxApplication).sort(compareTaxRows),
      total: serializeTotals(inputVatTotal),
    },
    netVat: serializeAmount(outputVatTotal.taxAmount.minus(inputVatTotal.taxAmount)),
    tds: {
      byMonth: monthTotals(tdsApps),
      byPartner: partnerTotals(tdsApps),
      rows: tdsApps.map(mapTaxApplication).sort(compareTaxRows),
      total: serializeTotals(tdsTotal),
    },
    vds: {
      byMonth: monthTotals(vdsApps),
      rows: vdsApps.map(mapTaxApplication).sort(compareTaxRows),
      total: serializeTotals(vdsTotal),
    },
  };
}
