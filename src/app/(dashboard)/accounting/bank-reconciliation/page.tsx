import Link from "next/link";
import { BankStatementStatus } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/shared/Card";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Pagination } from "@/components/shared/Pagination";
import { StatusBadge, humanizeStatus } from "@/components/shared/StatusBadge";
import { TableBox, Td, Th, tableRowClassName } from "@/components/shared/TableBox";
import { buildQueryString, parseListParams, type ListSearchParams } from "@/lib/list-params";
import { getPaginatedBankStatements } from "@/modules/bank-reconciliation/services/bank-reconciliation.service";

// Statement/line state changes as matching happens elsewhere in the app —
// same "never statically prerendered" rule as the journal entries list.
export const dynamic = "force-dynamic";

const BASE_PATH = "/accounting/bank-reconciliation";
const STATUSES: BankStatementStatus[] = ["IMPORTED", "IN_PROGRESS", "RECONCILED"];
type SearchParams = ListSearchParams & {
  status?: string | string[];
};

function getSingleValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function BankReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const listParams = parseListParams(params);
  const statusValue = getSingleValue(params.status);
  const status = STATUSES.find((value) => value === statusValue);
  const { items, total, page } = await getPaginatedBankStatements({
    ...listParams,
    status,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bank Reconciliation"
        description="Imported bank statements and their matching progress."
        actions={
          <Button asChild>
            <Link href={`${BASE_PATH}/import`}>Import Statement</Link>
          </Button>
        }
      />

      <Card>
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input type="hidden" name="pageSize" value={listParams.pageSize} />
          <label className="space-y-1 text-sm lg:col-span-2">
            <span>Search bank account</span>
            <input
              type="search"
              name="search"
              defaultValue={listParams.search}
              placeholder="Account code or name"
              className="w-full rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span>Status</span>
            <select
              name="status"
              defaultValue={status ?? ""}
              className="w-full rounded-md border border-input bg-background px-3 py-2"
            >
              <option value="">All statuses</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {humanizeStatus(value)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              Apply
            </button>
            <Link
              href={`${BASE_PATH}${buildQueryString({}, { pageSize: String(listParams.pageSize) })}`}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              Clear
            </Link>
          </div>
        </form>
      </Card>

      <TableBox
        title="Bank Statements"
        footer={
          <Pagination
            page={page}
            pageSize={listParams.pageSize}
            total={total}
            searchParams={params}
          />
        }
      >
        {items.length === 0 ? (
          <EmptyState title="No bank statements found" description="Try changing the filters." />
        ) : (
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr>
                <Th>Statement</Th>
                <Th>Bank Account</Th>
                <Th alignment="center">Period</Th>
                <Th alignment="right">Lines</Th>
                <Th alignment="center">Status</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((statement) => (
                <tr key={statement.id} className={tableRowClassName}>
                  <Td className="font-medium">
                    <Link
                      href={`${BASE_PATH}/${statement.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {`Imported ${statement.importedAt.toLocaleDateString()}`}
                    </Link>
                  </Td>
                  <Td>{`${statement.accountCode} — ${statement.accountName}`}</Td>
                  <Td alignment="center">
                    {`${statement.periodStart.toLocaleDateString()} – ${statement.periodEnd.toLocaleDateString()}`}
                  </Td>
                  <Td alignment="right">{statement.totalLines}</Td>
                  <Td alignment="center">
                    <StatusBadge status={statement.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableBox>
    </div>
  );
}
