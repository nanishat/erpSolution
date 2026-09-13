import Link from "next/link";
import { notFound } from "next/navigation";

import { BankStatementLineList } from "@/modules/bank-reconciliation/components/BankStatementLineList";
import { BankStatementStatusBadge } from "@/modules/bank-reconciliation/components/BankStatementStatusBadge";
import {
  getBankStatementById,
  getReconciliationSummary,
  suggestMatches,
} from "@/modules/bank-reconciliation/services/bank-reconciliation.service";

// Matching state changes as the user works through it — never statically
// prerendered/cached, same rule as every other reconciliation/ledger page.
export const dynamic = "force-dynamic";

export default async function BankStatementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const statement = await getBankStatementById(id);

  if (!statement) {
    notFound();
  }

  // suggestMatches only ever returns candidates for this statement's
  // UNMATCHED lines — safe (and cheap) to fetch unconditionally alongside
  // the summary rather than re-fetching per line client-side.
  const [summary, suggestions] = await Promise.all([
    getReconciliationSummary(id),
    suggestMatches(id),
  ]);

  const suggestionsByLineId = Object.fromEntries(suggestions.map((s) => [s.bankStatementLineId, s.candidates]));

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{`${statement.accountCode} — ${statement.accountName}`}</h1>
          <BankStatementStatusBadge status={statement.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {`${statement.periodStart.toLocaleDateString()} – ${statement.periodEnd.toLocaleDateString()}`}
        </p>
      </div>

      {/*
        Each stat is one "Label: value" text node (not a split label/value
        pair) so a UI test can assert on an exact, unambiguous rendered
        string (e.g. ">Matched: 2<") instead of a bare digit that could
        coincide with an unrelated number elsewhere on the page.
      */}
      <div className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="text-sm">{`Opening: ${statement.openingBalance.toFixed(2)}`}</div>
        <div className="text-sm">{`Closing: ${statement.closingBalance.toFixed(2)}`}</div>
        <div className="text-sm">{`Reconciled: ${summary.reconciledBalance.toFixed(2)}`}</div>
        <div className={`text-sm ${summary.difference === 0 ? "" : "text-destructive"}`}>
          {`Difference: ${summary.difference.toFixed(2)}`}
        </div>
        <div className="text-sm">{`Matched: ${summary.matchedCount}`}</div>
        <div className="text-sm">{`Unmatched: ${summary.unmatchedCount}`}</div>
        <div className="text-sm">{`Ignored: ${summary.ignoredCount}`}</div>
        <div className="text-sm">{`Total lines: ${summary.totalLines}`}</div>
      </div>

      <BankStatementLineList
        bankStatementId={statement.id}
        lines={statement.lines}
        suggestionsByLineId={suggestionsByLineId}
      />

      <Link
        href="/accounting/bank-reconciliation"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        ← Back to statements
      </Link>
    </div>
  );
}
