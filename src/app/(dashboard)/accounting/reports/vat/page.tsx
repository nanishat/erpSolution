import Link from "next/link";

import { ReportExportLinks } from "@/modules/accounting/components/ReportExportLinks";
import { VatReportFilters } from "@/modules/accounting/components/VatReportFilters";
import { getVatReport, type VatReportResult } from "@/modules/accounting/services/vat-report.service";
import { vatReportQuerySchema } from "@/modules/accounting/services/report-utils";

export const dynamic = "force-dynamic";

type VatReportSearchParams = {
  from?: string;
  to?: string;
};

function DetailTable({
  title,
  rows,
  total,
  taxLabel,
}: {
  title: string;
  rows: VatReportResult["outputVat"]["rows"];
  total: VatReportResult["outputVat"]["total"];
  taxLabel: string;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Document number</th>
              <th className="px-3 py-2">Partner</th>
              <th className="px-3 py-2">TIN</th>
              <th className="px-3 py-2">BIN</th>
              <th className="px-3 py-2 text-right">Base amount</th>
              <th className="px-3 py-2 text-right">Rate %</th>
              <th className="px-3 py-2 text-right">{taxLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-2 text-muted-foreground" colSpan={8}>
                  No activity.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const href = row.invoiceId
                  ? row.invoiceDirection === "VENDOR"
                    ? `/accounting/vendor-bills/${row.invoiceId}`
                    : `/accounting/invoices/${row.invoiceId}`
                  : `/accounting/journal-entries/${row.journalEntryId}`;
                return (
                  <tr
                    key={`${row.journalEntryId}-${row.documentNumber}-${index}`}
                    className="border-t border-border"
                  >
                    <td className="whitespace-nowrap px-3 py-2">{row.date}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link href={href} className="font-mono text-primary hover:underline">
                        {row.documentNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {row.partnerName ?? "No partner (voucher)"}
                    </td>
                    <td className="px-3 py-2">{row.tin ?? "—"}</td>
                    <td className="px-3 py-2">{row.bin ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{row.baseAmount.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{row.ratePercent.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{row.taxAmount.toFixed(2)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="px-3 py-2" colSpan={5}>
                Total
              </td>
              <td className="px-3 py-2 text-right">{total.baseAmount.toFixed(2)}</td>
              <td />
              <td className="px-3 py-2 text-right">{total.taxAmount.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function MonthSummary({
  title,
  rows,
}: {
  title: string;
  rows: VatReportResult["tds"]["byMonth"];
}) {
  return (
    <section className="space-y-3">
      <h3 className="font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2 text-right">Base amount</th>
                <th className="px-3 py-2 text-right">Tax amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.month} className="border-t border-border">
                  <td className="px-3 py-2">{row.month}</td>
                  <td className="px-3 py-2 text-right">{row.baseAmount.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{row.taxAmount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TdsPartnerSummary({ report }: { report: VatReportResult["tds"] }) {
  return (
    <section className="space-y-3">
      <h3 className="font-medium">TDS by partner</h3>
      {report.byPartner.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Partner</th>
                <th className="px-3 py-2">TIN</th>
                <th className="px-3 py-2">BIN</th>
                <th className="px-3 py-2 text-right">Base amount</th>
                <th className="px-3 py-2 text-right">Tax amount</th>
              </tr>
            </thead>
            <tbody>
              {report.byPartner.map((partner, index) => (
                <tr
                  key={`${partner.partnerName}-${partner.tin ?? ""}-${index}`}
                  className="border-t border-border"
                >
                  <td className="px-3 py-2">{partner.partnerName}</td>
                  <td className="px-3 py-2">{partner.tin ?? "—"}</td>
                  <td className="px-3 py-2">{partner.bin ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{partner.baseAmount.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{partner.taxAmount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default async function VatReportPage({
  searchParams,
}: {
  searchParams: Promise<VatReportSearchParams>;
}) {
  const params = await searchParams;
  const parsed = vatReportQuerySchema.safeParse(params);
  const report = parsed.success ? await getVatReport(parsed.data) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">VAT / TDS / VDS Report</h1>
        <p className="text-sm text-muted-foreground">
          Tax applications on posted journal entries, company-wide. Amounts in BDT.
        </p>
      </div>

      <VatReportFilters defaultValues={params} />
      <ReportExportLinks
        path="/api/reports/vat"
        filters={{ from: params.from, to: params.to }}
      />

      {!parsed.success && (
        <p className="text-sm text-destructive">
          {parsed.error.issues[0]?.message ?? "Invalid report filters."}
        </p>
      )}

      {report && (
        <>
          <DetailTable
            title="Output VAT (sales)"
            rows={report.outputVat.rows}
            total={report.outputVat.total}
            taxLabel="VAT amount"
          />
          <DetailTable
            title="Input VAT (purchases)"
            rows={report.inputVat.rows}
            total={report.inputVat.total}
            taxLabel="VAT amount"
          />
          <section className="flex flex-wrap items-center justify-between gap-2 border-y-2 border-border py-3 text-lg font-semibold">
            <span>Net VAT — output less input</span>
            <span>
              {report.netVat > 0
                ? "Payable"
                : report.netVat < 0
                  ? "Refundable / carry-forward"
                  : "No net balance"}{" "}
              ({report.netVat.toFixed(2)})
            </span>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold">TDS</h2>
            <MonthSummary title="TDS by month" rows={report.tds.byMonth} />
            <TdsPartnerSummary report={report.tds} />
            <DetailTable
              title="TDS details"
              rows={report.tds.rows}
              total={report.tds.total}
              taxLabel="TDS amount"
            />
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold">VDS</h2>
            <MonthSummary title="VDS by month" rows={report.vds.byMonth} />
            <DetailTable
              title="VDS details"
              rows={report.vds.rows}
              total={report.vds.total}
              taxLabel="VDS amount"
            />
          </section>
        </>
      )}
    </div>
  );
}
