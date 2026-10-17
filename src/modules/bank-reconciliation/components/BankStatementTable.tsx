import Link from "next/link";

import type { BankStatementListItemDTO } from "@/modules/bank-reconciliation/services/bank-reconciliation.service";
import { BankStatementStatusBadge } from "@/modules/bank-reconciliation/components/BankStatementStatusBadge";

// No client-side interaction here, so this stays server-renderable; balances
// arrive Number-serialized by listBankStatements.
export function BankStatementTable({ statements }: { statements: BankStatementListItemDTO[] }) {
  if (statements.length === 0) {
    return <p className="text-sm text-muted-foreground">No bank statements imported yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Account</th>
            <th className="px-3 py-2">Period</th>
            <th className="px-3 py-2 text-right">Opening</th>
            <th className="px-3 py-2 text-right">Closing</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2 text-right">Lines</th>
            <th className="px-3 py-2">Imported</th>
          </tr>
        </thead>
        <tbody>
          {statements.map((statement) => (
            <tr key={statement.id} className="border-t border-border">
              <td className="px-3 py-2">
                <Link
                  href={`/accounting/bank-reconciliation/${statement.id}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {`${statement.accountCode} — ${statement.accountName}`}
                </Link>
              </td>
              <td className="px-3 py-2">
                {`${statement.periodStart.toLocaleDateString()} – ${statement.periodEnd.toLocaleDateString()}`}
              </td>
              <td className="px-3 py-2 text-right">{statement.openingBalance.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">{statement.closingBalance.toFixed(2)}</td>
              <td className="px-3 py-2">
                <BankStatementStatusBadge status={statement.status} />
              </td>
              <td className="px-3 py-2 text-right">
                {`${statement.totalLines} (${statement.matchedCount} matched, ${statement.unmatchedCount} unmatched, ${statement.ignoredCount} ignored)`}
              </td>
              <td className="px-3 py-2">{statement.importedAt.toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
