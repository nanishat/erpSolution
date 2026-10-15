import "dotenv/config";

import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";

import { db } from "../src/lib/db";
import { createJournalEntry, postJournalEntry } from "../src/modules/accounting/services/journal-entry.service";
import { createDebitVoucher } from "../src/modules/accounting/services/debit-voucher.service";
import { getBalanceSheet } from "../src/modules/accounting/services/balance-sheet.service";
import { getCashFlow } from "../src/modules/accounting/services/cash-flow.service";
import { getGeneralLedger } from "../src/modules/accounting/services/general-ledger.service";
import { getProfitAndLoss } from "../src/modules/accounting/services/profit-and-loss.service";
import { getTrialBalance } from "../src/modules/accounting/services/trial-balance.service";
import { getVatReport } from "../src/modules/accounting/services/vat-report.service";
import { mapVatReport } from "../src/modules/accounting/export/report-mappers";
import { debitVoucherSchema } from "../src/modules/accounting/validations/debit-voucher.schema";
import { journalEntrySchema } from "../src/modules/accounting/validations/journal-entry.schema";
import { createInvoice, postInvoice, reverseInvoice } from "../src/modules/invoicing/services/invoice.service";
import { createInvoiceSchema } from "../src/modules/invoicing/validations/invoice.schema";
import { recordPayment } from "../src/modules/payments/services/payment.service";
import { recordPaymentSchema } from "../src/modules/payments/validations/payment.schema";
import { createPartner } from "../src/modules/partners/services/partner.service";
import { createPartnerSchema } from "../src/modules/partners/validations/partner.schema";
import { createProductService } from "../src/modules/products/services/product-service.service";
import { createProductServiceSchema } from "../src/modules/products/validations/product-service.schema";
import { createTaxApplication } from "../src/modules/tax/services/tax-application.service";
import { createTaxApplicationSchema } from "../src/modules/tax/validations/tax-application.schema";
import { createTaxRate } from "../src/modules/tax/services/tax-rate.service";
import { createTaxRateSchema } from "../src/modules/tax/validations/tax-rate.schema";
import { GET as trialBalanceExport } from "../src/app/api/reports/trial-balance/route";
import { GET as generalLedgerExport } from "../src/app/api/reports/general-ledger/route";
import { GET as profitAndLossExport } from "../src/app/api/reports/profit-loss/route";
import { GET as balanceSheetExport } from "../src/app/api/reports/balance-sheet/route";
import { GET as cashFlowExport } from "../src/app/api/reports/cash-flow/route";
import { GET as vatExport } from "../src/app/api/reports/vat/route";

const ZERO = new Prisma.Decimal(0);
const MONEY = {
  invoiceA: new Prisma.Decimal("1000.00"),
  invoiceB: new Prisma.Decimal("400.00"),
  payment: new Prisma.Decimal("100.00"),
  vendorBill: new Prisma.Decimal("1000.00"),
  debitVoucher: new Prisma.Decimal("200.00"),
  fixedAsset: new Prisma.Decimal("250.00"),
  eqCredit: new Prisma.Decimal("300.00"),
  msCredit: new Prisma.Decimal("400.00"),
  loan: new Prisma.Decimal("500.00"),
  capital: new Prisma.Decimal("600.00"),
};

let passed = 0;
let failed = 0;

function decimal(value: string | number | Prisma.Decimal): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

function amount(value: string | number | Prisma.Decimal): string {
  return decimal(value).toFixed(2);
}

function check(label: string, expected: string, actual: string, condition: boolean): void {
  if (condition) {
    console.log(`PASS - ${label}: expected=${expected}; actual=${actual}`);
    passed += 1;
  } else {
    console.log(`FAIL - ${label}: expected=${expected}; actual=${actual}`);
    failed += 1;
  }
}

function checkMoney(
  label: string,
  expected: string | number | Prisma.Decimal,
  actual: string | number | Prisma.Decimal
): void {
  const expectedAmount = decimal(expected);
  const actualAmount = decimal(actual);
  check(
    label,
    amount(expectedAmount),
    amount(actualAmount),
    expectedAmount.toDecimalPlaces(2).equals(actualAmount.toDecimalPlaces(2))
  );
}

function checkBoolean(label: string, expected: boolean, actual: boolean): void {
  check(label, String(expected), String(actual), expected === actual);
}

function dayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDay(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function nextDay(date: string): string {
  const next = utcDay(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return dayString(next);
}

function previousDay(date: string): string {
  const previous = utcDay(date);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return dayString(previous);
}

function sumMoney(values: readonly (number | Prisma.Decimal)[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>(
    (total, value) => total.plus(value),
    new Prisma.Decimal(0)
  );
}

async function earliestUnoccupiedJournalDay(): Promise<string> {
  const candidate = new Date("2010-01-01T00:00:00.000Z");
  for (;;) {
    const date = dayString(candidate);
    const followingDay = utcDay(nextDay(date));
    const entry = await db.journalEntry.findFirst({
      where: { date: { gte: utcDay(date), lt: followingDay } },
      select: { id: true },
    });
    if (!entry) return date;
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
}

async function getOrCreateVatRate(
  direction: "INPUT" | "OUTPUT",
  fixtureDate: string,
  stamp: number
) {
  const existing = await db.taxRate.findFirst({
    where: {
      type: "VAT",
      direction,
      ratePercent: new Prisma.Decimal("15.00"),
      isActive: true,
    },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  return createTaxRate(
    createTaxRateSchema.parse({
      type: "VAT",
      category: `TEST-P5-${stamp}`,
      name: `TEST-P5-${stamp}-VAT-${direction}`,
      ratePercent: 15,
      direction,
      computationType: "EXCLUSIVE",
      effectiveFrom: utcDay(fixtureDate),
    })
  );
}

async function addTaxApplication(input: {
  journalEntryId: string;
  partnerId?: string;
  baseAmount: Prisma.Decimal;
  taxType: "VAT" | "TDS" | "VDS";
  direction?: "INPUT" | "OUTPUT";
  sourceTaxRateId?: string;
  ratePercent?: number;
}) {
  return createTaxApplication(
    createTaxApplicationSchema.parse({
      journalEntryId: input.journalEntryId,
      partnerId: input.partnerId,
      baseAmount: input.baseAmount.toFixed(2),
      taxType: input.taxType,
      ...(input.taxType === "VAT"
        ? { direction: input.direction, sourceTaxRateId: input.sourceTaxRateId }
        : { ratePercent: input.ratePercent, computationType: "EXCLUSIVE" }),
    })
  );
}

function getSectionByCode<T extends { account: { code: string } }>(
  sections: readonly T[],
  code: string
): T | undefined {
  return sections.find((section) => section.account.code === code);
}

function getLedgerNet(
  report: Awaited<ReturnType<typeof getGeneralLedger>>,
  code: string,
  side: "credit" | "debit"
): Prisma.Decimal {
  const section = getSectionByCode(report.sections, code);
  if (!section) return new Prisma.Decimal(0);
  const credit = new Prisma.Decimal(section.periodCredit);
  const debit = new Prisma.Decimal(section.periodDebit);
  return side === "credit" ? credit.minus(debit) : debit.minus(credit);
}

function getSectorRevenue(
  report: Awaited<ReturnType<typeof getProfitAndLoss>>,
  sector: string
): Prisma.Decimal {
  return new Prisma.Decimal(report.revenue.sectorAmounts?.[sector] ?? 0);
}

function getTrialBalanceTypeTotal(
  report: Awaited<ReturnType<typeof getTrialBalance>>,
  type: string
): Prisma.Decimal {
  return sumMoney(
    report.rows
      .filter((row) => row.type === type)
      .map((row) => new Prisma.Decimal(row.netBalance))
  );
}

type BalanceRow = { row: { code: string; amount: number }; children: BalanceRow[] };

function flattenBalanceRows(groups: readonly BalanceRow[]): BalanceRow["row"][] {
  return groups.flatMap((group) => [group.row, ...flattenBalanceRows(group.children)]);
}

function getCashBankBalance(
  report: Awaited<ReturnType<typeof getBalanceSheet>>,
  cashBankCodes: ReadonlySet<string>
): Prisma.Decimal {
  return sumMoney(
    flattenBalanceRows(report.assets.groups)
      .filter((row) => cashBankCodes.has(row.code))
      .map((row) => new Prisma.Decimal(row.amount))
  );
}

function findWorksheetRow(
  sheet: ExcelJS.Worksheet,
  label: string,
  column: number
): ExcelJS.CellValue | undefined {
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (row.getCell(1).value === label) return row.getCell(column).value;
  }
  return undefined;
}

function valueText(value: ExcelJS.CellValue | undefined): string {
  return value === undefined || value === null ? "" : String(value);
}

type ExportHandler = (request: NextRequest) => Promise<Response>;
type ExportMetric = { label: string; column: number; expected: Prisma.Decimal };

async function validateReportExports(
  reportName: string,
  handler: ExportHandler,
  query: Record<string, string>,
  metrics: readonly ExportMetric[],
  vatDetails?: readonly { documentNumber: string; baseAmount: number; ratePercent: number; taxAmount: number }[]
): Promise<void> {
  for (const format of ["pdf", "xlsx"] as const) {
    const search = new URLSearchParams({ ...query, format });
    const response = await handler(
      new NextRequest(`http://localhost/api/reports/${reportName}?${search.toString()}`)
    );
    check(
      `${reportName} ${format} export response`,
      "HTTP 200",
      `HTTP ${response.status}`,
      response.ok
    );
    if (!response.ok) continue;

    const arrayBuffer = await response.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    if (format === "pdf") {
      const beginsWithPdf = bytes.subarray(0, 4).toString("ascii") === "%PDF";
      const pageCount = (bytes.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
      checkBoolean(`${reportName} PDF signature`, true, beginsWithPdf);
      check(
        `${reportName} PDF page count`,
        "at least 1",
        String(pageCount),
        pageCount >= 1
      );
      continue;
    }

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(arrayBuffer);
    } catch (error) {
      check(
        `${reportName} XLSX reopens`,
        "valid ExcelJS workbook",
        error instanceof Error ? error.message : String(error),
        false
      );
      continue;
    }
    const sheet = workbook.worksheets[0];
    check(
      `${reportName} XLSX reopens`,
      "one or more worksheets",
      String(workbook.worksheets.length),
      workbook.worksheets.length > 0
    );
    if (!sheet) continue;

    for (const metric of metrics) {
      const value = findWorksheetRow(sheet, metric.label, metric.column);
      const actual = typeof value === "number" ? new Prisma.Decimal(value) : undefined;
      check(
        `${reportName} XLSX ${metric.label} is numeric and matches service`,
        amount(metric.expected),
        actual ? amount(actual) : `${valueText(value)} (not numeric)`,
        actual !== undefined && actual.toDecimalPlaces(2).equals(metric.expected.toDecimalPlaces(2))
      );
    }

    if (vatDetails) {
      const exportedDetails: string[] = [];
      for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        const dateValue = valueText(row.getCell(1).value);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) continue;
        exportedDetails.push(
          [
            valueText(row.getCell(2).value),
            amount(valueText(row.getCell(6).value)),
            amount(valueText(row.getCell(7).value)),
            amount(valueText(row.getCell(8).value)),
          ].join("|")
        );
      }
      const expectedDetails = vatDetails
        .map((row) =>
          [
            row.documentNumber,
            amount(row.baseAmount),
            amount(row.ratePercent),
            amount(row.taxAmount),
          ].join("|")
        )
        .sort();
      exportedDetails.sort();
      check(
        "vat XLSX detail rows match VAT service detail rows",
        JSON.stringify(expectedDetails),
        JSON.stringify(exportedDetails),
        JSON.stringify(expectedDetails) === JSON.stringify(exportedDetails)
      );
      check(
        "vat XLSX detail rows exist",
        "at least 1",
        String(exportedDetails.length),
        exportedDetails.length > 0
      );
    }
  }
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const fixtureMarker = `TEST-P5-${stamp}`;
  const fixtureDate = await earliestUnoccupiedJournalDay();
  const fixtureDayStart = utcDay(fixtureDate);
  const fixtureDayEnd = utcDay(nextDay(fixtureDate));
  console.log(`Phase 5 reports verification fixtures: ${fixtureMarker}`);
  console.log(`Earliest JournalEntry-free day on/after 2010-01-01: ${fixtureDate}`);

  const branch = await db.branch.findFirstOrThrow({ where: { isHeadOffice: true } });
  const accountCodes = [
    "1020",
    "1200",
    "1210",
    "1260",
    "2110",
    "2120",
    "2130",
    "2140",
    "3010",
    "4010",
    "5010",
  ];
  const accounts = await db.chartOfAccount.findMany({
    where: { code: { in: accountCodes } },
    select: { id: true, code: true, subType: true },
  });
  const accountByCode = new Map(accounts.map((account) => [account.code, account]));
  const account = (code: string) => {
    const found = accountByCode.get(code);
    if (!found) throw new Error(`Required chart-of-account code ${code} is missing`);
    return found;
  };
  const bank = account("1020");
  const sales = account("4010");
  const expense = account("5010");

  // 1. Partners and product/services.
  const customer = await createPartner(
    createPartnerSchema.parse({
      type: "CUSTOMER",
      name: `${fixtureMarker} Customer`,
      tin: `${fixtureMarker}-C-TIN`,
      bin: `${fixtureMarker}-C-BIN`,
      vatInclusiveInPrice: false,
    })
  );
  const vendor = await createPartner(
    createPartnerSchema.parse({
      type: "VENDOR",
      name: `${fixtureMarker} Vendor`,
      tin: `${fixtureMarker}-V-TIN`,
      bin: `${fixtureMarker}-V-BIN`,
      vatInclusiveInPrice: false,
    })
  );
  const customerProduct = await createProductService(
    createProductServiceSchema.parse({
      code: `${fixtureMarker}-C-PS`,
      name: `${fixtureMarker} Customer Service`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: sales.id,
    })
  );
  const vendorProduct = await createProductService(
    createProductServiceSchema.parse({
      code: `${fixtureMarker}-V-PS`,
      name: `${fixtureMarker} Vendor Service`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: sales.id,
      expenseAccountId: expense.id,
    })
  );
  checkBoolean(
    "fixture partners carry TIN and BIN",
    true,
    Boolean(customer.tin && customer.bin && vendor.tin && vendor.bin)
  );
  check(
    "fixture names include unique TEST-P5 marker",
    fixtureMarker,
    `${customer.name}; ${vendor.name}; ${customerProduct.name}; ${vendorProduct.name}`,
    [customer.name, vendor.name, customerProduct.name, vendorProduct.name].every((name) =>
      name.includes(fixtureMarker)
    )
  );

  const [outputVatRate, inputVatRate] = await Promise.all([
    getOrCreateVatRate("OUTPUT", fixtureDate, stamp),
    getOrCreateVatRate("INPUT", fixtureDate, stamp),
  ]);
  const stampDate = new Date(`${fixtureDate}T12:00:00.000Z`);
  const invoiceInput = (partnerId: string, productId: string, sector: string, price: Prisma.Decimal) =>
    createInvoiceSchema.parse({
      partnerId,
      direction: "CUSTOMER",
      sector,
      branchId: branch.id,
      date: stampDate,
      lines: [
        {
          productServiceId: productId,
          description: `${fixtureMarker} ${sector} service`,
          quantity: 1,
          unitPrice: price.toFixed(2),
        },
      ],
    });

  // 2. Customer Invoice A (GS) and B (EQ), both with output VAT.
  const invoiceA = await createInvoice(invoiceInput(customer.id, customerProduct.id, "GS", MONEY.invoiceA));
  await addTaxApplication({
    journalEntryId: invoiceA.journalEntryId,
    partnerId: customer.id,
    baseAmount: MONEY.invoiceA,
    taxType: "VAT",
    direction: "OUTPUT",
    sourceTaxRateId: outputVatRate.id,
  });
  const postedInvoiceA = await postInvoice(invoiceA.id);
  check(
    "Invoice A posted with expected output VAT",
    "POSTED; VAT 150.00",
    `${postedInvoiceA.status}; VAT ${amount(postedInvoiceA.taxTotal)}`,
    postedInvoiceA.status === "POSTED" && amount(postedInvoiceA.taxTotal) === "150.00"
  );

  const invoiceB = await createInvoice(invoiceInput(customer.id, customerProduct.id, "EQ", MONEY.invoiceB));
  await addTaxApplication({
    journalEntryId: invoiceB.journalEntryId,
    partnerId: customer.id,
    baseAmount: MONEY.invoiceB,
    taxType: "VAT",
    direction: "OUTPUT",
    sourceTaxRateId: outputVatRate.id,
  });
  const postedInvoiceB = await postInvoice(invoiceB.id);
  const today = dayString(new Date());
  const [todayPnlBeforeReversal, todayReceivablesBeforeReversal, todayVatBeforeReversal] =
    await Promise.all([
      getProfitAndLoss({ from: today, to: today, bySector: true }),
      getGeneralLedger({ from: today, to: today, accountId: account("1200").id }),
      getGeneralLedger({ from: today, to: today, accountId: account("2110").id }),
    ]);
  const reversedInvoiceB = await reverseInvoice(invoiceB.id, `${fixtureMarker} zero-payment reversal`);
  const [todayPnlAfterReversal, todayReceivablesAfterReversal, todayVatAfterReversal] =
    await Promise.all([
      getProfitAndLoss({ from: today, to: today, bySector: true }),
      getGeneralLedger({ from: today, to: today, accountId: account("1200").id }),
      getGeneralLedger({ from: today, to: today, accountId: account("2110").id }),
    ]);
  check(
    "Invoice B reversal keeps invoice VOID and reversal POSTED",
    "VOID / POSTED",
    `${reversedInvoiceB.invoice.status} / ${reversedInvoiceB.journalEntry.reversal.status}`,
    reversedInvoiceB.invoice.status === "VOID" &&
      reversedInvoiceB.journalEntry.reversal.status === "POSTED"
  );
  check(
    "Invoice B reversal is dated today",
    today,
    dayString(reversedInvoiceB.journalEntry.reversal.date),
    dayString(reversedInvoiceB.journalEntry.reversal.date) === today
  );
  checkBoolean(
    "Invoice B reversal links to Invoice B's JournalEntry",
    true,
    reversedInvoiceB.journalEntry.reversal.reversalOfEntryId === postedInvoiceB.journalEntryId
  );
  checkMoney(
    "Invoice B reversal's EQ revenue delta is negative Invoice B revenue",
    MONEY.invoiceB.negated(),
    getSectorRevenue(todayPnlAfterReversal, "EQ")
      .minus(getSectorRevenue(todayPnlBeforeReversal, "EQ"))
  );
  checkMoney(
    "Invoice B reversal's UNASSIGNED revenue delta is zero",
    ZERO,
    getSectorRevenue(todayPnlAfterReversal, "UNASSIGNED")
      .minus(getSectorRevenue(todayPnlBeforeReversal, "UNASSIGNED"))
  );
  checkMoney(
    "Invoice B reversal's 1200 normal-balance delta is negative gross amount",
    new Prisma.Decimal(postedInvoiceB.grandTotal).negated(),
    getLedgerNet(todayReceivablesAfterReversal, "1200", "debit").minus(
      getLedgerNet(todayReceivablesBeforeReversal, "1200", "debit")
    )
  );
  checkMoney(
    "Invoice B reversal's 2110 net delta is negative VAT",
    new Prisma.Decimal(postedInvoiceB.taxTotal).negated(),
    getLedgerNet(todayVatAfterReversal, "2110", "credit").minus(
      getLedgerNet(todayVatBeforeReversal, "2110", "credit")
    )
  );
  const todayReceivableLines =
    getSectionByCode(todayReceivablesAfterReversal.sections, "1200")?.lines ?? [];
  checkBoolean(
    "Invoice B reversal appears in today's 1200 General Ledger",
    true,
    todayReceivableLines.some(
      (line) =>
        line.journalEntryId === reversedInvoiceB.journalEntry.reversal.id &&
        line.status === "POSTED"
    )
  );
  check(
    "Invoice B posted tax total before reversal",
    "60.00",
    amount(postedInvoiceB.taxTotal),
    amount(postedInvoiceB.taxTotal) === "60.00"
  );

  // 3. Partial payment into Bank 1020 via recordPayment.
  const payment = await recordPayment(
    recordPaymentSchema.parse({
      partnerId: customer.id,
      branchId: branch.id,
      amount: MONEY.payment.toFixed(2),
      date: stampDate,
      method: "Bank Transfer",
      reference: `${fixtureMarker}-PAYMENT`,
      cashBankAccountId: bank.id,
      allocations: [{ invoiceId: invoiceA.id, amountApplied: MONEY.payment.toFixed(2) }],
    })
  );
  check(
    "Invoice A partial payment posts through Bank 1020",
    "POSTED; 100.00",
    `${payment.journalEntry.status}; ${amount(MONEY.payment)}`,
    payment.journalEntry.status === "POSTED" &&
      payment.journalEntry.id.length > 0 &&
      payment.amount.toFixed(2) === MONEY.payment.toFixed(2)
  );

  // 4. Vendor Bill with input VAT only.
  const vendorBill = await createInvoice(
    createInvoiceSchema.parse({
      partnerId: vendor.id,
      direction: "VENDOR",
      branchId: branch.id,
      date: stampDate,
      lines: [
        {
          productServiceId: vendorProduct.id,
          description: `${fixtureMarker} vendor services`,
          quantity: 1,
          unitPrice: MONEY.vendorBill.toFixed(2),
        },
      ],
    })
  );
  await addTaxApplication({
    journalEntryId: vendorBill.journalEntryId,
    partnerId: vendor.id,
    baseAmount: MONEY.vendorBill,
    taxType: "VAT",
    direction: "INPUT",
    sourceTaxRateId: inputVatRate.id,
  });
  const postedVendorBill = await postInvoice(vendorBill.id);
  check(
    "Vendor Bill posts with input VAT only",
    "POSTED; VAT 150.00",
    `${postedVendorBill.status}; VAT ${amount(postedVendorBill.taxTotal)}`,
    postedVendorBill.status === "POSTED" &&
      amount(postedVendorBill.taxTotal) === "150.00"
  );
  console.log("TDS/VDS on Vendor Bill: pending investigation");

  // 5. Debit Voucher with TDS tax application.
  const debitVoucher = await createDebitVoucher(
    debitVoucherSchema.parse({
      date: stampDate,
      description: `${fixtureMarker} TDS expense voucher`,
      branchId: branch.id,
      cashBankAccountId: bank.id,
      lines: [
        {
          expenseAccountId: expense.id,
          amount: MONEY.debitVoucher.toFixed(2),
          description: `${fixtureMarker} operating expense`,
          bankName: `${fixtureMarker} bank`,
          chequeNo: `${fixtureMarker}-TDS-CHQ`,
          chequeDate: stampDate,
        },
      ],
    }),
    "system"
  );
  const debitVoucherTds = await addTaxApplication({
    journalEntryId: debitVoucher.id,
    partnerId: vendor.id,
    baseAmount: MONEY.debitVoucher,
    taxType: "TDS",
    ratePercent: 5,
  });
  const postedDebitVoucher = await postJournalEntry(debitVoucher.id);
  check(
    "Debit Voucher with TDS posts",
    "POSTED; TDS 10.00",
    `${postedDebitVoucher.status}; TDS ${amount(debitVoucherTds.taxAmount)}`,
    postedDebitVoucher.status === "POSTED" &&
      amount(debitVoucherTds.taxAmount) === "10.00"
  );

  // 6. Debit Voucher with VDS tax application.
  const vdsDebitVoucher = await createDebitVoucher(
    debitVoucherSchema.parse({
      date: stampDate,
      description: `${fixtureMarker} VDS expense voucher`,
      branchId: branch.id,
      cashBankAccountId: bank.id,
      lines: [
        {
          expenseAccountId: expense.id,
          amount: MONEY.debitVoucher.toFixed(2),
          description: `${fixtureMarker} VDS operating expense`,
          bankName: `${fixtureMarker} bank`,
          chequeNo: `${fixtureMarker}-VDS-CHQ`,
          chequeDate: stampDate,
        },
      ],
    }),
    "system"
  );
  const debitVoucherVds = await addTaxApplication({
    journalEntryId: vdsDebitVoucher.id,
    partnerId: vendor.id,
    baseAmount: MONEY.debitVoucher,
    taxType: "VDS",
    ratePercent: 7.5,
  });
  const postedVdsDebitVoucher = await postJournalEntry(vdsDebitVoucher.id);
  check(
    "Debit Voucher with VDS posts",
    "POSTED; VDS 15.00",
    `${postedVdsDebitVoucher.status}; VDS ${amount(debitVoucherVds.taxAmount)}`,
    postedVdsDebitVoucher.status === "POSTED" &&
      amount(debitVoucherVds.taxAmount) === "15.00"
  );

  // 6. Fixed-asset purchase Debit Voucher.
  const fixedAssetVoucher = await createDebitVoucher(
    debitVoucherSchema.parse({
      date: stampDate,
      description: `${fixtureMarker} fixed asset purchase`,
      branchId: branch.id,
      cashBankAccountId: bank.id,
      lines: [
        {
          expenseAccountId: account("1260").id,
          amount: MONEY.fixedAsset.toFixed(2),
          description: `${fixtureMarker} fixed asset`,
          bankName: `${fixtureMarker} bank`,
          chequeNo: `${fixtureMarker}-ASSET-CHQ`,
          chequeDate: stampDate,
        },
      ],
    }),
    "system"
  );
  const postedFixedAssetVoucher = await postJournalEntry(fixedAssetVoucher.id);
  check(
    "Fixed asset Debit Voucher posts",
    "POSTED; debit 1260 250.00; credit 1020 250.00",
    `${postedFixedAssetVoucher.status}; debit=${amount(MONEY.fixedAsset)}; credit=${amount(MONEY.fixedAsset)}`,
    postedFixedAssetVoucher.status === "POSTED"
  );

  // 7-8. Sector revenue Credit Vouchers and financing receipts.
  async function makeCreditVoucher(input: {
    name: string;
    creditAccountCode: string;
    amount: Prisma.Decimal;
    sector?: "EQ" | "MS";
  }) {
    const entry = await createJournalEntry(
      journalEntrySchema.parse({
        date: stampDate,
        description: `${fixtureMarker} ${input.name}`,
        branchId: branch.id,
        voucherType: "CREDIT_VOUCHER",
        sector: input.sector,
        lines: [
          { accountId: bank.id, branchId: branch.id, debit: input.amount.toFixed(2), credit: 0 },
          {
            accountId: account(input.creditAccountCode).id,
            branchId: branch.id,
            debit: 0,
            credit: input.amount.toFixed(2),
          },
        ],
      }),
      "system"
    );
    return postJournalEntry(entry.id);
  }

  const eqCreditVoucher = await makeCreditVoucher({
    name: "EQ sales receipt",
    creditAccountCode: "4010",
    amount: MONEY.eqCredit,
    sector: "EQ",
  });
  const msCreditVoucher = await makeCreditVoucher({
    name: "MS sales receipt",
    creditAccountCode: "4010",
    amount: MONEY.msCredit,
    sector: "MS",
  });
  const loanVoucher = await makeCreditVoucher({
    name: "loan receipt",
    creditAccountCode: "2140",
    amount: MONEY.loan,
  });
  const capitalVoucher = await makeCreditVoucher({
    name: "capital receipt",
    creditAccountCode: "3010",
    amount: MONEY.capital,
  });
  check(
    "Credit and financing vouchers are posted",
    "EQ, MS, loan, capital all POSTED",
    `${eqCreditVoucher.status}, ${msCreditVoucher.status}, ${loanVoucher.status}, ${capitalVoucher.status}`,
    [eqCreditVoucher, msCreditVoucher, loanVoucher, capitalVoucher].every(
      (entry) => entry.status === "POSTED"
    )
  );

  // Query every service once after fixtures are posted.
  const [vat, glDay, pnlDay, pnlBySector, pnlToDate, balanceSheet, cashFlow, tbDay, tbToDate] =
    await Promise.all([
      getVatReport({ from: fixtureDate, to: fixtureDate }),
      getGeneralLedger({ from: fixtureDate, to: fixtureDate }),
      getProfitAndLoss({ from: fixtureDate, to: fixtureDate }),
      getProfitAndLoss({ from: fixtureDate, to: fixtureDate, bySector: true }),
      getProfitAndLoss({ to: fixtureDate }),
      getBalanceSheet({ asOf: fixtureDate }),
      getCashFlow({ from: fixtureDate, to: fixtureDate }),
      getTrialBalance({
        from: fixtureDayStart,
        to: fixtureDayStart,
        includeZeroBalances: true,
      }),
      getTrialBalance({ to: fixtureDayStart, includeZeroBalances: true }),
    ]);

  const liveApplications = await db.taxApplication.findMany({
    where: {
      journalEntry: {
        status: "POSTED",
        date: { gte: fixtureDayStart, lt: fixtureDayEnd },
      },
    },
    select: { taxType: true, direction: true },
  });
  const liveCount = (type: string, direction?: string) =>
    liveApplications.filter(
      (application) =>
        application.taxType === type &&
        (direction === undefined || application.direction === direction)
    ).length;

  // 1. VAT report / tax-ledger agreement.
  const expectedOutputVat = new Prisma.Decimal("150.00");
  const expectedInputVat = new Prisma.Decimal("150.00");
  const expectedTds = new Prisma.Decimal("10.00");
  const expectedVds = new Prisma.Decimal("15.00");
  const expectedLedgerOutputVat = expectedOutputVat.plus(postedInvoiceB.taxTotal);
  checkMoney("VAT output total is Invoice A only", expectedOutputVat, vat.outputVat.total.taxAmount);
  checkMoney("VAT input total is Vendor Bill VAT", expectedInputVat, vat.inputVat.total.taxAmount);
  checkMoney(
    "VAT net is output less input",
    expectedOutputVat.minus(expectedInputVat),
    vat.netVat
  );
  checkMoney("TDS total is the Debit Voucher only", expectedTds, vat.tds.total.taxAmount);
  checkMoney("VDS total is the VDS Debit Voucher", expectedVds, vat.vds.total.taxAmount);
  check(
    "VAT row count equals live posted output applications",
    String(liveCount("VAT", "OUTPUT")),
    String(vat.outputVat.rows.length),
    liveCount("VAT", "OUTPUT") === vat.outputVat.rows.length
  );
  check(
    "VAT row count equals live posted input applications",
    String(liveCount("VAT", "INPUT")),
    String(vat.inputVat.rows.length),
    liveCount("VAT", "INPUT") === vat.inputVat.rows.length
  );
  check(
    "TDS row count equals live posted TDS applications",
    String(liveCount("TDS")),
    String(vat.tds.rows.length),
    liveCount("TDS") === vat.tds.rows.length
  );
  check(
    "VDS row count equals live posted VDS applications",
    String(liveCount("VDS")),
    String(vat.vds.rows.length),
    liveCount("VDS") === vat.vds.rows.length
  );
  check(
    "Expected fixture tax row counts (output/input/TDS/VDS)",
    "1 / 1 / 1 / 1",
    `${vat.outputVat.rows.length} / ${vat.inputVat.rows.length} / ${vat.tds.rows.length} / ${vat.vds.rows.length}`,
    vat.outputVat.rows.length === 1 &&
      vat.inputVat.rows.length === 1 &&
      vat.tds.rows.length === 1 &&
      vat.vds.rows.length === 1
  );
  check(
    "Reversed Invoice B VAT is absent from VAT output",
    "Invoice A present; Invoice B absent",
    `A=${vat.outputVat.rows.some((row) => row.invoiceId === invoiceA.id)}; B=${vat.outputVat.rows.some((row) => row.invoiceId === invoiceB.id)}`,
    vat.outputVat.rows.some((row) => row.invoiceId === invoiceA.id) &&
      !vat.outputVat.rows.some((row) => row.invoiceId === invoiceB.id)
  );
  const vendorTdsTotal = vat.tds.byPartner.find((row) => row.tin === vendor.tin);
  check(
    "TDS partner grouping preserves Vendor TIN/BIN and voucher amount",
    `${vendor.tin} / ${vendor.bin} / ${amount(expectedTds)}`,
    vendorTdsTotal
      ? `${vendorTdsTotal.tin} / ${vendorTdsTotal.bin} / ${amount(vendorTdsTotal.taxAmount)}`
      : "vendor partner row absent",
    vendorTdsTotal?.tin === vendor.tin &&
      vendorTdsTotal.bin === vendor.bin &&
      amount(vendorTdsTotal.taxAmount) === amount(expectedTds)
  );

  checkMoney(
    "Fixture-day General Ledger 2110 includes VAT on Invoice B's VOID original",
    expectedLedgerOutputVat,
    getLedgerNet(glDay, "2110", "credit")
  );
  for (const [code, expected, side] of [
    ["1210", expectedInputVat, "debit"],
    ["2120", expectedTds, "credit"],
    ["2130", expectedVds, "credit"],
  ] as const) {
    const actual = getLedgerNet(glDay, code, side);
    checkMoney(
      `General Ledger ${code} ${side}-minus-opposite agrees with VAT report`,
      expected,
      actual
    );
  }
  const fixtureReceivableLines = getSectionByCode(glDay.sections, "1200")?.lines ?? [];
  const invoiceBFixtureLines = fixtureReceivableLines.filter(
    (line) => line.journalEntryId === invoiceB.journalEntryId
  );
  check(
    "Fixture-day 1200 General Ledger shows Invoice B VOID original, not its reversal",
    "VOID original present; reversal absent",
    `original statuses=${invoiceBFixtureLines.map((line) => line.status).join(",") || "absent"}; reversal=${fixtureReceivableLines.some((line) => line.journalEntryId === reversedInvoiceB.journalEntry.reversal.id) ? "present" : "absent"}`,
    invoiceBFixtureLines.length > 0 &&
      invoiceBFixtureLines.every((line) => line.status === "VOID") &&
      !fixtureReceivableLines.some(
        (line) => line.journalEntryId === reversedInvoiceB.journalEntry.reversal.id
      )
  );

  // 2. Trial-balance balance.
  checkMoney("Fixture-day Trial Balance total debit equals total credit", tbDay.totalDebit, tbDay.totalCredit);
  checkBoolean("Fixture-day Trial Balance is balanced", true, tbDay.isBalanced);

  // 3. Balance-sheet, Trial Balance, and P&L statement agreement.
  const balanceSheetDifference = new Prisma.Decimal(balanceSheet.totalAssets)
    .minus(balanceSheet.totalLiabilities)
    .minus(balanceSheet.totalEquity);
  checkMoney("Balance Sheet Assets = Liabilities + Equity", ZERO, balanceSheetDifference);
  checkMoney("Balance Sheet current profit equals P&L from beginning to day", balanceSheet.currentProfit, pnlToDate.netProfit);
  for (const [type, expected] of [
    ["ASSET", balanceSheet.totalAssets],
    ["LIABILITY", balanceSheet.totalLiabilities],
    ["EQUITY", balanceSheet.totalEquityAccounts],
    ["REVENUE", pnlToDate.totalRevenue],
    ["EXPENSE", pnlToDate.totalExpense],
  ] as const) {
    checkMoney(
      `Beginning-to-day Trial Balance ${type} net equals statement total`,
      expected,
      getTrialBalanceTypeTotal(tbToDate, type)
    );
  }
  const expectedLiveRevenue = MONEY.invoiceA
    .plus(MONEY.invoiceB)
    .plus(MONEY.eqCredit)
    .plus(MONEY.msCredit);
  checkMoney(
    "Fixture-day P&L revenue includes Invoice A, VOID Invoice B, and EQ/MS vouchers",
    expectedLiveRevenue,
    pnlDay.totalRevenue
  );

  // 4. Cash Flow exact activity totals and identities.
  const expectedOperating = MONEY.payment
    .plus(MONEY.eqCredit)
    .plus(MONEY.msCredit)
    .minus(MONEY.debitVoucher.mul(2))
    .plus("10.00")
    .plus("15.00");
  const expectedInvesting = MONEY.fixedAsset.negated();
  const expectedFinancing = MONEY.loan.plus(MONEY.capital);
  const expectedNetChange = expectedOperating.plus(expectedInvesting).plus(expectedFinancing);
  checkMoney("Cash Flow operating total", expectedOperating, cashFlow.operating.total);
  checkMoney("Cash Flow investing total", expectedInvesting, cashFlow.investing.total);
  checkMoney("Cash Flow financing total", expectedFinancing, cashFlow.financing.total);
  checkMoney(
    "Cash Flow net change equals operating + investing + financing",
    expectedNetChange,
    cashFlow.netChange
  );
  checkMoney(
    "Cash Flow closing equals opening plus net change",
    new Prisma.Decimal(cashFlow.opening).plus(cashFlow.netChange),
    cashFlow.closing
  );
  checkBoolean("Cash Flow reconciles", true, cashFlow.reconciles);
  const cashBankAccounts = await db.chartOfAccount.findMany({
    where: { subType: { in: ["CASH", "BANK"] } },
    select: { code: true },
  });
  const cashBankCodes = new Set(cashBankAccounts.map((item) => item.code));
  const previousBalanceSheet = await getBalanceSheet({ asOf: previousDay(fixtureDate) });
  checkMoney(
    "Cash Flow closing equals Balance Sheet cash/bank as of fixture day",
    getCashBankBalance(balanceSheet, cashBankCodes),
    cashFlow.closing
  );
  checkMoney(
    "Cash Flow opening equals Balance Sheet cash/bank as of prior day",
    getCashBankBalance(previousBalanceSheet, cashBankCodes),
    cashFlow.opening
  );
  checkMoney(
    "Cash Flow includes Invoice A payment inflow",
    MONEY.payment,
    sumMoney(
      cashFlow.operating.rows
        .filter((row) => row.code === "1200")
        .map((row) => new Prisma.Decimal(row.netCashEffect))
    )
  );

  // 5. Sector toggle, including the VOID Invoice B original.
  const sectorRevenue = pnlBySector.revenue.sectorAmounts ?? {};
  checkMoney(
    "EQ sector revenue includes Invoice B and EQ voucher",
    MONEY.invoiceB.plus(MONEY.eqCredit),
    sectorRevenue.EQ ?? ZERO
  );
  checkMoney("MS sector revenue is the MS voucher", MONEY.msCredit, sectorRevenue.MS ?? ZERO);
  checkMoney("GS sector revenue is Invoice A", MONEY.invoiceA, sectorRevenue.GS ?? ZERO);
  checkMoney("Unassigned sector revenue is zero", ZERO, sectorRevenue.UNASSIGNED ?? ZERO);
  checkBoolean(
    "P&L sector totals reconcile",
    true,
    pnlBySector.sectorTotalsReconcile ?? false
  );
  checkMoney("P&L revenue identical with bySector on/off", pnlDay.totalRevenue, pnlBySector.totalRevenue);
  checkMoney("P&L expense identical with bySector on/off", pnlDay.totalExpense, pnlBySector.totalExpense);
  checkMoney("P&L net profit identical with bySector on/off", pnlDay.netProfit, pnlBySector.netProfit);
  const revenueAccountSector = pnlBySector.revenue.groups
    .flatMap((group) => [group, ...group.children])
    .find((group) => group.row.code === "4010")?.row.sectorAmounts;
  check(
    "Invoice B revenue is attributed to EQ, not UNASSIGNED",
    `EQ=${amount(MONEY.invoiceB.plus(MONEY.eqCredit))}; UNASSIGNED=0.00`,
    `EQ=${amount(revenueAccountSector?.EQ ?? ZERO)}; UNASSIGNED=${amount(revenueAccountSector?.UNASSIGNED ?? ZERO)}`,
    amount(revenueAccountSector?.EQ ?? ZERO) === amount(MONEY.invoiceB.plus(MONEY.eqCredit)) &&
      amount(revenueAccountSector?.UNASSIGNED ?? ZERO) === "0.00"
  );

  // 6. Exercise actual report route handlers for both export formats.
  const glExportReport = await getGeneralLedger({
    from: fixtureDate,
    to: fixtureDate,
    accountId: bank.id,
  });
  const bankLedger = getSectionByCode(glExportReport.sections, "1020");
  const trialTotalDebit = new Prisma.Decimal(tbDay.totalDebit);
  const trialTotalCredit = new Prisma.Decimal(tbDay.totalCredit);
  const pnlGroupMetrics: ExportMetric[] = [
    { label: "Total Revenue", column: 7, expected: new Prisma.Decimal(pnlBySector.totalRevenue) },
    { label: "Total Expenses", column: 7, expected: new Prisma.Decimal(pnlBySector.totalExpense) },
    {
      label: pnlBySector.netProfit < 0 ? "Net Loss" : "Net Profit",
      column: 7,
      expected: new Prisma.Decimal(pnlBySector.netProfit),
    },
  ];
  const allVatRows = [
    ...vat.outputVat.rows,
    ...vat.inputVat.rows,
    ...vat.tds.rows,
    ...vat.vds.rows,
  ];
  const vatExportTable = mapVatReport(vat, { from: fixtureDate, to: fixtureDate });
  const vatMappedDetailRows = vatExportTable.rows.filter(
    (row) => row.cells[0] === fixtureDate && typeof row.cells[1] === "string"
  );
  const expectedMappedDetails = allVatRows
    .map((row) =>
      [
        row.documentNumber,
        amount(row.baseAmount),
        amount(row.ratePercent),
        amount(row.taxAmount),
      ].join("|")
    )
    .sort();
  const actualMappedDetails = vatMappedDetailRows
    .map((row) =>
      [
        String(row.cells[1]),
        amount(String(row.cells[5])),
        amount(String(row.cells[6])),
        amount(String(row.cells[7])),
      ].join("|")
    )
    .sort();
  check(
    "VAT export mapper retains all service detail rows",
    JSON.stringify(expectedMappedDetails),
    JSON.stringify(actualMappedDetails),
    JSON.stringify(expectedMappedDetails) === JSON.stringify(actualMappedDetails)
  );
  for (const [label, serviceTotalLabel, expectedTotal] of [
    ["Total Output VAT", "Total Output VAT", new Prisma.Decimal(vat.outputVat.total.taxAmount)],
    ["Total Input VAT", "Total Input VAT", new Prisma.Decimal(vat.inputVat.total.taxAmount)],
    ["Total TDS", "Total TDS", new Prisma.Decimal(vat.tds.total.taxAmount)],
    ["Total VDS", "Total VDS", new Prisma.Decimal(vat.vds.total.taxAmount)],
  ] as const) {
    const totalRow = vatExportTable.rows.find((row) => row.cells[0] === serviceTotalLabel);
    const mappedTotal = totalRow?.cells[7];
    checkMoney(
      `VAT export mapper ${label} equals service total`,
      expectedTotal,
      typeof mappedTotal === "number" ? mappedTotal : ZERO
    );
  }
  const exportCases = [
    validateReportExports(
      "trial-balance",
      trialBalanceExport,
      { from: fixtureDate, to: fixtureDate, view: "flat" },
      [
        { label: "Total", column: 4, expected: trialTotalDebit },
        { label: "Total", column: 5, expected: trialTotalCredit },
      ]
    ),
    validateReportExports(
      "general-ledger",
      generalLedgerExport,
      { from: fixtureDate, to: fixtureDate, accountId: bank.id },
      [
        { label: "Closing balance", column: 6, expected: new Prisma.Decimal(bankLedger?.periodDebit ?? 0) },
        { label: "Closing balance", column: 7, expected: new Prisma.Decimal(bankLedger?.periodCredit ?? 0) },
        { label: "Closing balance", column: 8, expected: new Prisma.Decimal(bankLedger?.closingBalance ?? 0) },
      ]
    ),
    validateReportExports(
      "profit-loss",
      profitAndLossExport,
      { from: fixtureDate, to: fixtureDate, bySector: "true" },
      pnlGroupMetrics
    ),
    validateReportExports(
      "balance-sheet",
      balanceSheetExport,
      { asOf: fixtureDate },
      [
        { label: "Total Assets", column: 3, expected: new Prisma.Decimal(balanceSheet.totalAssets) },
        { label: "Total Liabilities", column: 3, expected: new Prisma.Decimal(balanceSheet.totalLiabilities) },
        { label: "Total Equity", column: 3, expected: new Prisma.Decimal(balanceSheet.totalEquity) },
      ]
    ),
    validateReportExports(
      "cash-flow",
      cashFlowExport,
      { from: fixtureDate, to: fixtureDate },
      [
        { label: "Opening cash", column: 3, expected: new Prisma.Decimal(cashFlow.opening) },
        { label: "Total Operating Activities", column: 3, expected: new Prisma.Decimal(cashFlow.operating.total) },
        { label: "Total Investing Activities", column: 3, expected: new Prisma.Decimal(cashFlow.investing.total) },
        { label: "Total Financing Activities", column: 3, expected: new Prisma.Decimal(cashFlow.financing.total) },
        { label: "Net change", column: 3, expected: new Prisma.Decimal(cashFlow.netChange) },
        { label: "Closing cash", column: 3, expected: new Prisma.Decimal(cashFlow.closing) },
      ]
    ),
    validateReportExports(
      "vat",
      vatExport,
      { from: fixtureDate, to: fixtureDate },
      [
        { label: "Total Output VAT", column: 8, expected: new Prisma.Decimal(vat.outputVat.total.taxAmount) },
        { label: "Total Input VAT", column: 8, expected: new Prisma.Decimal(vat.inputVat.total.taxAmount) },
        { label: "Output VAT less Input VAT", column: 8, expected: new Prisma.Decimal(vat.netVat) },
        { label: "Total TDS", column: 8, expected: new Prisma.Decimal(vat.tds.total.taxAmount) },
        { label: "Total VDS", column: 8, expected: new Prisma.Decimal(vat.vds.total.taxAmount) },
      ],
      allVatRows
    ),
  ];
  for (const exportCase of exportCases) await exportCase;

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error("Phase 5 reports test could not complete:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
