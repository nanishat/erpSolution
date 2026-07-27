import type { TrialBalanceResult } from "@/modules/accounting/services/trial-balance.service";

export function TrialBalanceTable({ report }: { report: TrialBalanceResult }) {
  if (report.rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No activity for the selected filters.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {!report.isBalanced && (
        <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
          Trial balance is out of balance — total debits ({report.totalDebit.toFixed(2)}) do
          not equal total credits ({report.totalCredit.toFixed(2)}). This indicates a data
          integrity issue and should be investigated.
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-right">Debit</th>
              <th className="px-3 py-2 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.accountId} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs">{row.code}</td>
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{row.type}</td>
                <td className="px-3 py-2 text-right">{row.totalDebit.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{row.totalCredit.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr
              className={
                "border-t-2 font-semibold " +
                (report.isBalanced
                  ? "border-border"
                  : "border-destructive bg-destructive/10 text-destructive")
              }
            >
              <td className="px-3 py-2" colSpan={3}>
                Total{!report.isBalanced && " — NOT BALANCED"}
              </td>
              <td className="px-3 py-2 text-right">{report.totalDebit.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">{report.totalCredit.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
