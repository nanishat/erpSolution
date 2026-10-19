import Link from "next/link";

import { Amount } from "@/components/shared/Amount";
import { ActiveReportFilters, ReportQuickLinks, ReportSummary } from "@/components/shared/ReportLayout";
import { Card } from "@/components/shared/Card";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { ReportDetailsControls } from "@/components/shared/ReportDetailsControls";
import { TableBox, Td, Th } from "@/components/shared/TableBox";
import { ReportExportLinks } from "@/modules/accounting/components/ReportExportLinks";
import { VatReportFilters } from "@/modules/accounting/components/VatReportFilters";
import { getVatReport, type VatReportResult } from "@/modules/accounting/services/vat-report.service";
import { vatReportQuerySchema } from "@/modules/accounting/services/report-utils";

export const dynamic = "force-dynamic";

type VatReportSearchParams = {
  from?: string;
  to?: string;
  month?: string;
  fiscalYear?: string;
};

function selectedDates(params: VatReportSearchParams) {
  if (params.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month)) {
    const [year, month] = params.month.split("-").map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    return {
      from: `${params.month}-01`,
      to: `${params.month}-${String(lastDay).padStart(2, "0")}`,
    };
  }
  if (params.fiscalYear && /^\d{4}$/.test(params.fiscalYear)) {
    const year = Number(params.fiscalYear);
    return { from: `${year}-07-01`, to: `${year + 1}-06-30` };
  }
  return { from: params.from, to: params.to };
}

function DetailTable({
  rows,
  taxLabel,
}: {
  rows: VatReportResult["outputVat"]["rows"];
  taxLabel: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <Th alignment="center">Date</Th>
            <Th>Document number</Th>
            <Th>Partner</Th>
            <Th>TIN</Th>
            <Th>BIN</Th>
            <Th alignment="right">Base amount</Th>
            <Th alignment="right">Rate %</Th>
            <Th alignment="right">{taxLabel}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const href = row.invoiceId
              ? row.invoiceDirection === "VENDOR"
                ? `/accounting/vendor-bills/${row.invoiceId}`
                : `/accounting/invoices/${row.invoiceId}`
              : `/accounting/journal-entries/${row.journalEntryId}`;
            return (
              <tr key={`${row.journalEntryId}-${row.documentNumber}-${index}`} className="border-t border-border">
                <Td alignment="center" className="whitespace-nowrap">{row.date}</Td>
                <Td className="whitespace-nowrap">
                  <Link href={href} className="font-mono text-primary hover:underline">{row.documentNumber}</Link>
                </Td>
                <Td>{row.partnerName ?? "No partner (voucher)"}</Td>
                <Td>{row.tin ?? "—"}</Td>
                <Td>{row.bin ?? "—"}</Td>
                <Td alignment="right"><Amount value={row.baseAmount} /></Td>
                <Td alignment="right"><Amount value={row.ratePercent} /></Td>
                <Td alignment="right"><Amount value={row.taxAmount} /></Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MonthSummary({ rows }: { rows: VatReportResult["tds"]["byMonth"] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr><Th>Month</Th><Th alignment="right">Base amount</Th><Th alignment="right">Tax amount</Th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.month} className="border-t border-border">
              <Td>{row.month}</Td>
              <Td alignment="right"><Amount value={row.baseAmount} /></Td>
              <Td alignment="right"><Amount value={row.taxAmount} /></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PartnerSummary({ report }: { report: VatReportResult["tds"] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr><Th>Partner</Th><Th>TIN</Th><Th>BIN</Th><Th alignment="right">Base amount</Th><Th alignment="right">Tax amount</Th></tr></thead>
        <tbody>
          {report.byPartner.map((partner, index) => (
            <tr key={`${partner.partnerName}-${partner.tin ?? ""}-${index}`} className="border-t border-border">
              <Td>{partner.partnerName}</Td><Td>{partner.tin ?? "—"}</Td><Td>{partner.bin ?? "—"}</Td>
              <Td alignment="right"><Amount value={partner.baseAmount} /></Td>
              <Td alignment="right"><Amount value={partner.taxAmount} /></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function VatReportPage({
  searchParams,
}: {
  searchParams: Promise<VatReportSearchParams>;
}) {
  const params = await searchParams;
  const dates = selectedDates(params);
  const parsed = vatReportQuerySchema.safeParse(dates);
  const report = parsed.success ? await getVatReport(parsed.data) : null;
  const hasActivity = Boolean(
    report &&
      (report.outputVat.rows.length ||
        report.inputVat.rows.length ||
        report.tds.rows.length ||
        report.vds.rows.length)
  );
  const reportGroups = report
    ? [
        {
          title: "Output VAT (sales)",
          amount: report.outputVat.total.taxAmount,
          children: <DetailTable rows={report.outputVat.rows} taxLabel="VAT amount" />,
        },
        {
          title: "Input VAT (purchases)",
          amount: report.inputVat.total.taxAmount,
          children: <DetailTable rows={report.inputVat.rows} taxLabel="VAT amount" />,
        },
        {
          title: "TDS by month",
          amount: report.tds.total.taxAmount,
          children: <MonthSummary rows={report.tds.byMonth} />,
        },
        {
          title: "TDS by partner",
          amount: report.tds.total.taxAmount,
          children: <PartnerSummary report={report.tds} />,
        },
        {
          title: "TDS details",
          amount: report.tds.total.taxAmount,
          children: <DetailTable rows={report.tds.rows} taxLabel="TDS amount" />,
        },
        {
          title: "VDS by month",
          amount: report.vds.total.taxAmount,
          children: <MonthSummary rows={report.vds.byMonth} />,
        },
        {
          title: "VDS details",
          amount: report.vds.total.taxAmount,
          children: <DetailTable rows={report.vds.rows} taxLabel="VDS amount" />,
        },
      ]
    : [];
  const clearHref = "/accounting/reports/vat";

  return (
    <div className="accounting-report-page space-y-5">
      <PageHeader
        title="VAT / TDS / VDS Report"
        description="Tax collected and paid for the selected period."
        actions={
          <ReportExportLinks path="/api/reports/vat" filters={{ from: dates.from, to: dates.to }} />
        }
      />

      <Card title="Filters" className="report-filter-card">
        <ReportQuickLinks path="/accounting/reports/vat" filters={{ from: dates.from, to: dates.to }} />
        <VatReportFilters from={dates.from} to={dates.to} />
        <ActiveReportFilters from={dates.from} to={dates.to} />
      </Card>

      {!parsed.success && (
        <p className="text-sm text-destructive">
          {parsed.error.issues[0]?.message ?? "Invalid report filters."}
        </p>
      )}

      {report && hasActivity && (
        <>
          <ReportSummary
            items={[
              { label: "Output VAT", value: report.outputVat.total.taxAmount },
              { label: "Input VAT", value: report.inputVat.total.taxAmount },
              { label: "Net VAT payable", value: report.netVat },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            TDS total: <Amount value={report.tds.total.taxAmount} /> · VDS total:{" "}
            <Amount value={report.vds.total.taxAmount} />
          </p>
        </>
      )}

      {report && !hasActivity ? (
        <TableBox title="Tax details">
          <EmptyState
            title="No activity for the selected period"
            action={<Link href={clearHref} className="text-primary underline-offset-4 hover:underline">Clear filters</Link>}
          />
        </TableBox>
      ) : report ? (
        <TableBox title="Tax details">
          <div className="px-4 pt-3">
            <ReportDetailsControls>
              {reportGroups.map((group) => (
                <details key={group.title} className="report-details rounded-lg border border-border" open={reportGroups.length <= 8}>
                  <summary className="px-4 py-3 text-sm font-semibold">
                    <span>{group.title}</span>
                    <span className="ml-auto pr-2 text-right tabular-nums"><Amount value={group.amount} /></span>
                  </summary>
                  <div className="border-t border-border">{group.children}</div>
                </details>
              ))}
            </ReportDetailsControls>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <Td colSpan={2}>Output VAT total</Td>
                  <Td alignment="right"><Amount value={report.outputVat.total.taxAmount} /></Td>
                </tr>
                <tr className="border-t border-border font-semibold">
                  <Td colSpan={2}>Input VAT total</Td>
                  <Td alignment="right"><Amount value={report.inputVat.total.taxAmount} /></Td>
                </tr>
                <tr className="border-t border-border font-semibold">
                  <Td colSpan={2}>TDS total</Td>
                  <Td alignment="right"><Amount value={report.tds.total.taxAmount} /></Td>
                </tr>
                <tr className="border-t border-border font-semibold">
                  <Td colSpan={2}>VDS total</Td>
                  <Td alignment="right"><Amount value={report.vds.total.taxAmount} /></Td>
                </tr>
                <tr className="border-t-2 border-border font-semibold">
                  <Td colSpan={2}>Net VAT payable</Td>
                  <Td alignment="right"><Amount value={report.netVat} /></Td>
                </tr>
              </tfoot>
            </table>
          </div>
        </TableBox>
      ) : null}
    </div>
  );
}
