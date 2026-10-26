import type { BankStatementLineMatchStatus } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Amount } from "@/components/shared/Amount";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";
import { Pagination } from "@/components/shared/Pagination";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { BankStatementLineList } from "@/modules/bank-reconciliation/components/BankStatementLineList";
import {
  getBankStatementDetailPage,
  getReconciliationSummary,
  suggestMatches,
} from "@/modules/bank-reconciliation/services/bank-reconciliation.service";
import { buildQueryString, parseListParams, type ListSearchParams } from "@/lib/list-params";

export const dynamic = "force-dynamic";

const BASE_PATH = "/accounting/bank-reconciliation";
const LINE_STATUSES: BankStatementLineMatchStatus[] = ["UNMATCHED", "MATCHED", "IGNORED"];

export default async function BankStatementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ListSearchParams>;
}) {
  const [{ id }, rawSearchParams] = await Promise.all([params, searchParams]);
  const { page, pageSize } = parseListParams(rawSearchParams);
  const rawStatus = rawSearchParams.status;
  const status =
    typeof rawStatus === "string"
      ? LINE_STATUSES.find((candidate) => candidate === rawStatus)
      : undefined;

  const statementPage = await getBankStatementDetailPage({
    id,
    page,
    pageSize,
    status,
  });

  if (!statementPage.statement) {
    notFound();
  }

  const statement = statementPage.statement;
  const [summary, suggestions] = await Promise.all([
    getReconciliationSummary(id),
    suggestMatches(id),
  ]);
  const suggestionsByLineId = Object.fromEntries(suggestions.map((s) => [s.bankStatementLineId, s.candidates]));
  const counts = [
    { status: "UNMATCHED" as const, label: "Unmatched", count: summary.unmatchedCount },
    { status: "MATCHED" as const, label: "Matched", count: summary.matchedCount },
    { status: "IGNORED" as const, label: "Ignored", count: summary.ignoredCount },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <>
            {`${statement.accountCode} — ${statement.accountName}`}
            <StatusBadge status={statement.status} />
          </>
        }
        description={`Bank statement · ${statement.periodStart.toLocaleDateString()} – ${statement.periodEnd.toLocaleDateString()}`}
      />

      <Card title="Statement summary">
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Bank account</dt>
            <dd className="text-sm">{statement.accountName}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Period</dt>
            <dd className="text-sm">
              {statement.periodStart.toLocaleDateString()} – {statement.periodEnd.toLocaleDateString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Import date</dt>
            <dd className="text-sm">{statement.importedAt.toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Opening balance</dt>
            <dd className="text-sm"><Amount value={statement.openingBalance} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Closing balance</dt>
            <dd className="text-sm"><Amount value={statement.closingBalance} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Reconciled balance</dt>
            <dd className="text-sm"><Amount value={summary.reconciledBalance} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Difference</dt>
            <dd className={`text-sm ${summary.difference === 0 ? "" : "text-destructive"}`}>
              <Amount value={summary.difference} />
            </dd>
          </div>
        </dl>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="!space-y-0 !p-0">
          <Link
            href={`${BASE_PATH}/${id}${buildQueryString(rawSearchParams, { status: undefined, page: "1" })}`}
            className="block rounded-xl px-4 py-3 hover:bg-muted/50"
          >
            <span className="text-xs text-muted-foreground">All lines</span>
            <span className="mt-1 block text-lg font-semibold tabular-nums">{summary.totalLines}</span>
          </Link>
        </Card>
        {counts.map((item) => (
          <Card key={item.status} className="!space-y-0 !p-0">
            <Link
              href={`${BASE_PATH}/${id}${buildQueryString(rawSearchParams, { status: item.status, page: "1" })}`}
              aria-current={status === item.status ? "page" : undefined}
              className="block rounded-xl px-4 py-3 hover:bg-muted/50"
            >
              <span className="text-xs text-muted-foreground">{item.label}</span>
              <span className="mt-1 block text-lg font-semibold tabular-nums">{item.count}</span>
            </Link>
          </Card>
        ))}
      </div>

      <BankStatementLineList
        bankStatementId={statement.id}
        lines={statementPage.lines}
        suggestionsByLineId={suggestionsByLineId}
        emptyMessage={
          statementPage.total === 0 && status
            ? `No ${status.toLowerCase()} lines.`
            : "No statement lines."
        }
      />
      <Pagination
        page={statementPage.page}
        pageSize={pageSize}
        total={statementPage.total}
        searchParams={rawSearchParams}
      />

      <Link
        href={BASE_PATH}
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        ← Back to statements
      </Link>
    </div>
  );
}
