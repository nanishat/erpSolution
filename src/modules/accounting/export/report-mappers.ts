import {
  UNASSIGNED_SECTOR,
  type ProfitAndLossGroup,
  type ProfitAndLossResult,
} from "@/modules/accounting/services/profit-and-loss.service";
import type { BalanceSheetGroup, BalanceSheetResult } from "@/modules/accounting/services/balance-sheet.service";
import type { CashFlowCategory, CashFlowResult } from "@/modules/accounting/services/cash-flow.service";
import type { GeneralLedgerResult } from "@/modules/accounting/services/general-ledger.service";
import type { TrialBalanceGroup, TrialBalanceResult } from "@/modules/accounting/services/trial-balance.service";
import type { ExportColumn, ExportRow, ExportTable } from "@/modules/accounting/export/report-export";

type ReportFilters = {
  from?: string | Date;
  to?: string | Date;
  asOf?: string;
  branchId?: string;
  accountId?: string;
  bySector?: boolean;
};

function dateValue(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function subtitles(filters: ReportFilters, rangeDescription = "Date range"): string[] {
  const from = dateValue(filters.from);
  const to = dateValue(filters.to);
  const period = filters.asOf
    ? `As of: ${filters.asOf}`
    : `${rangeDescription}: ${from ?? "Beginning"} to ${to ?? "Present"}`;
  return [
    period,
    ...(filters.branchId ? ["Branch filter: Applied"] : []),
    ...(filters.accountId ? ["Account filter: Applied"] : []),
    ...(filters.bySector ? ["Breakdown: By sector"] : []),
    "Amounts in BDT",
    `Generated: ${new Date().toISOString()}`,
  ];
}

function textColumn(label: string, widthWeight?: number): ExportColumn {
  return {
    label,
    align: "left",
    type: "text",
    ...(widthWeight ? { widthWeight } : {}),
  };
}

function numberColumn(label: string, widthWeight?: number): ExportColumn {
  return {
    label,
    align: "right",
    type: "number",
    ...(widthWeight ? { widthWeight } : {}),
  };
}

function row(
  cells: ExportRow["cells"],
  options: Pick<ExportRow, "indent" | "bold"> = {}
): ExportRow {
  return { cells, ...options };
}

function flattenTrialGroups(
  groups: TrialBalanceGroup[],
  depth = 0
): ExportRow[] {
  return groups.flatMap((group) => [
    row(
      [
        group.row.code,
        group.row.name,
        group.row.type,
        group.row.totalDebit,
        group.row.totalCredit,
        group.row.netBalance,
      ],
      { indent: depth, bold: group.children.length > 0 }
    ),
    ...flattenTrialGroups(group.children, depth + 1),
  ]);
}

export function mapTrialBalance(
  report: TrialBalanceResult,
  filters: ReportFilters,
  view: "flat" | "grouped"
): ExportTable {
  const rows =
    view === "grouped"
      ? flattenTrialGroups(report.groups)
      : report.rows.map((item) =>
          row([
            item.code,
            item.name,
            item.type,
            item.totalDebit,
            item.totalCredit,
            item.netBalance,
          ])
        );
  return {
    title: "Trial Balance",
    subtitleLines: subtitles(filters),
    columns: [
      textColumn("Code"),
      textColumn("Account"),
      textColumn("Type"),
      numberColumn("Debit"),
      numberColumn("Credit"),
      numberColumn("Net balance"),
    ],
    rows,
    footerRows: [
      row(
        ["Total", null, null, report.totalDebit, report.totalCredit, null],
        { bold: true }
      ),
    ],
    indentColumn: 1,
  };
}

export function mapGeneralLedger(
  report: GeneralLedgerResult,
  filters: ReportFilters
): ExportTable {
  const rows: ExportRow[] = [];
  for (const section of report.sections) {
    rows.push(row([section.account.name, null, null, null, null, null, null, null, null], { bold: true }));
    rows.push(
      row([
        "Opening balance",
        null,
        null,
        null,
        null,
        null,
        null,
        section.openingBalance,
        null,
      ])
    );
    for (const line of section.lines) {
      rows.push(
        row([
          line.date.toISOString().slice(0, 10),
          line.documentNumber,
          line.voucherType,
          line.memo ? `${line.description} — ${line.memo}` : line.description,
          line.branchName,
          line.debit,
          line.credit,
          line.runningBalance,
          line.status === "VOID" ? "VOID" : "",
        ])
      );
    }
    rows.push(
      row(
        [
          "Closing balance",
          null,
          null,
          null,
          null,
          section.periodDebit,
          section.periodCredit,
          section.closingBalance,
          null,
        ],
        { bold: true }
      )
    );
  }
  return {
    title: "General Ledger",
    subtitleLines: subtitles(filters),
    columns: [
      textColumn("Date", 0.85),
      textColumn("Document number", 1.2),
      textColumn("Type", 0.85),
      textColumn("Description", 2.2),
      textColumn("Branch", 1.1),
      numberColumn("Debit", 0.9),
      numberColumn("Credit", 0.9),
      numberColumn("Running balance", 1.2),
      textColumn("Status", 0.65),
    ],
    rows,
    footerRows: [],
  };
}

function flattenProfitGroups(
  groups: ProfitAndLossGroup[],
  sectorColumns: string[],
  depth = 0
): ExportRow[] {
  return groups.flatMap((group) => [
    row(
      [
        group.row.code,
        group.row.name,
        ...sectorColumns.map((sector) => group.row.sectorAmounts?.[sector] ?? 0),
        group.row.amount,
      ],
      { indent: depth, bold: group.children.length > 0 }
    ),
    ...flattenProfitGroups(group.children, sectorColumns, depth + 1),
  ]);
}

export function mapProfitAndLoss(
  report: ProfitAndLossResult,
  filters: ReportFilters
): ExportTable {
  const sectorColumns = filters.bySector
    ? [
        ...(report.sectors ?? []).filter((sector) => sector !== UNASSIGNED_SECTOR),
        UNASSIGNED_SECTOR,
      ]
    : [];
  const totalLabel = filters.bySector ? "Total" : "Amount";
  const rows: ExportRow[] = [];

  const addSection = (
    title: string,
    groups: ProfitAndLossGroup[],
    total: number,
    sectorTotals?: Record<string, number>
  ) => {
    rows.push(
      row([title, null, ...Array(sectorColumns.length + 1).fill(null)], {
        bold: true,
      })
    );
    rows.push(...flattenProfitGroups(groups, sectorColumns));
    rows.push(
      row(
        [
          `Total ${title}`,
          null,
          ...sectorColumns.map((sector) => sectorTotals?.[sector] ?? 0),
          total,
        ],
        { bold: true }
      )
    );
  };

  addSection("Revenue", report.revenue.groups, report.totalRevenue, report.revenue.sectorAmounts);
  addSection("Expenses", report.expenses.groups, report.totalExpense, report.expenses.sectorAmounts);
  return {
    title: "Profit & Loss",
    subtitleLines: subtitles(filters),
    columns: [
      textColumn("Code", 0.7),
      textColumn("Account", 2.5),
      ...sectorColumns.map((sector) =>
        numberColumn(sector === UNASSIGNED_SECTOR ? "Unassigned" : sector, 0.9)
      ),
      numberColumn(totalLabel, 1),
    ],
    rows,
    footerRows: [
      row(
        [
          report.netProfit < 0 ? "Net Loss" : "Net Profit",
          null,
          ...sectorColumns.map(() => null),
          report.netProfit,
        ],
        { bold: true }
      ),
    ],
    indentColumn: 1,
  };
}

function flattenBalanceGroups(
  groups: BalanceSheetGroup[],
  depth = 0
): ExportRow[] {
  return groups.flatMap((group) => [
    row([group.row.code, group.row.name, group.row.amount], {
      indent: depth,
      bold: group.children.length > 0,
    }),
    ...flattenBalanceGroups(group.children, depth + 1),
  ]);
}

export function mapBalanceSheet(report: BalanceSheetResult): ExportTable {
  const rows: ExportRow[] = [];
  const addSection = (
    title: string,
    groups: BalanceSheetGroup[],
    totalLabel: string,
    total: number
  ) => {
    rows.push(row([title, null, null], { bold: true }));
    rows.push(...flattenBalanceGroups(groups));
    rows.push(row([totalLabel, null, total], { bold: true }));
  };

  addSection("Assets", report.assets.groups, "Total Assets", report.totalAssets);
  addSection(
    "Liabilities",
    report.liabilities.groups,
    "Total Liabilities",
    report.totalLiabilities
  );
  addSection(
    "Equity",
    report.equity.groups,
    "Total Equity Accounts",
    report.totalEquityAccounts
  );
  rows.push(row(["Current Period Profit / (Loss)", null, report.currentProfit], { bold: true }));
  rows.push(row(["Total Equity", null, report.totalEquity], { bold: true }));

  return {
    title: "Balance Sheet",
    subtitleLines: subtitles({ asOf: report.asOf }),
    columns: [textColumn("Code"), textColumn("Account"), numberColumn("Balance")],
    rows,
    footerRows: [
      row(
        [
          report.balanced
            ? "Balanced"
            : `Out of balance (difference ${report.difference?.toFixed(2) ?? ""})`,
          null,
          report.difference,
        ],
        { bold: true }
      ),
    ],
    indentColumn: 1,
    footnotes: [
      "No Fixed Asset register or Accumulated Depreciation is maintained; fixed assets are shown from journal activity only.",
    ],
  };
}

const cashFlowSections: {
  category: CashFlowCategory;
  title: string;
}[] = [
  { category: "operating", title: "Operating Activities" },
  { category: "investing", title: "Investing Activities" },
  { category: "financing", title: "Financing Activities" },
];

export function mapCashFlow(
  report: CashFlowResult,
  filters: ReportFilters,
  effectiveTo: string
): ExportTable {
  const rows: ExportRow[] = [
    row(["Opening cash", null, report.opening], { bold: true }),
  ];
  for (const { category, title } of cashFlowSections) {
    const section = report[category];
    rows.push(row([title, null, null], { bold: true }));
    for (const item of section.rows) {
      rows.push(row([item.code, item.name, item.netCashEffect], { indent: 1 }));
    }
    rows.push(row([`Total ${title}`, null, section.total], { bold: true }));
  }
  rows.push(row(["Net change", null, report.netChange], { bold: true }));
  rows.push(row(["Closing cash", null, report.closing], { bold: true }));

  return {
    title: "Cash Flow Statement",
    subtitleLines: [
      ...subtitles({ ...filters, to: effectiveTo }),
    ],
    columns: [textColumn("Code"), textColumn("Account"), numberColumn("Amount")],
    rows,
    footerRows: [
      row(
        [
          report.reconciles
            ? "Reconciles with cash and bank balances"
            : `Does not reconcile (difference ${report.difference.toFixed(2)})`,
          null,
          report.reconciles ? null : report.difference,
        ],
        { bold: true }
      ),
    ],
    indentColumn: 1,
  };
}
