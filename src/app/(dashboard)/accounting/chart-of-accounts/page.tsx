import Link from "next/link";
import { AccountType } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/shared/Card";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Pagination } from "@/components/shared/Pagination";
import { StatusBadge, humanizeStatus } from "@/components/shared/StatusBadge";
import { TableBox, Td, Th, tableRowClassName } from "@/components/shared/TableBox";
import { buildQueryString, parseListParams, type ListSearchParams } from "@/lib/list-params";
import { getPaginatedChartOfAccounts } from "@/modules/accounting/services/chart-of-account.service";
import { listChartOfAccountsQuerySchema } from "@/modules/accounting/validations/chart-of-account.schema";

// Chart of Accounts is centrally calculated — never statically prerendered/cached.
export const dynamic = "force-dynamic";

const BASE_PATH = "/accounting/chart-of-accounts";
const ACCOUNT_TYPES: AccountType[] = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];
type SearchParams = ListSearchParams & {
  type?: string | string[];
  isActive?: string | string[];
};

function getSingleValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function ChartOfAccountsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const listParams = parseListParams(params);
  const parsedType = listChartOfAccountsQuerySchema.shape.type.safeParse(
    getSingleValue(params.type)
  );
  const parsedActive = listChartOfAccountsQuerySchema.shape.isActive.safeParse(
    getSingleValue(params.isActive)
  );
  const type = parsedType.success ? parsedType.data : undefined;
  const isActive = parsedActive.success ? (parsedActive.data ?? true) : true;
  const activeValue = isActive === "all" ? "all" : String(isActive);
  const { items, total, page } = await getPaginatedChartOfAccounts({
    ...listParams,
    type,
    isActive,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Chart of Accounts"
        description="One shared, centrally-calculated chart of accounts — not scoped per branch."
        actions={
          <>
            <Link
              href={`${BASE_PATH}/tree`}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Tree View
            </Link>
            <Button asChild>
              <Link href={`${BASE_PATH}/new`}>New Account</Link>
            </Button>
          </>
        }
      />

      <Card>
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <input type="hidden" name="pageSize" value={listParams.pageSize} />
          <label className="space-y-1 text-sm lg:col-span-2">
            <span>Search</span>
            <input
              type="search"
              name="search"
              defaultValue={listParams.search}
              placeholder="Code or name"
              className="w-full rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span>Account type</span>
            <select
              name="type"
              defaultValue={type ?? ""}
              className="w-full rounded-md border border-input bg-background px-3 py-2"
            >
              <option value="">All types</option>
              {ACCOUNT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {humanizeStatus(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>Status</span>
            <select
              name="isActive"
              defaultValue={activeValue}
              className="w-full rounded-md border border-input bg-background px-3 py-2"
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
              <option value="all">All statuses</option>
            </select>
          </label>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
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
        title="Chart of Accounts"
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
          <EmptyState title="No accounts found" description="Try changing the filters." />
        ) : (
          <table className="w-full min-w-180 border-collapse">
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Sub Type</Th>
                <Th alignment="center">Postable</Th>
                <Th alignment="center">Status</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((account) => (
                <tr key={account.id} className={tableRowClassName}>
                  <Td>{account.code}</Td>
                  <Td
                    className={`${account.parentId ? "pl-6 " : ""}${account.isPostable ? "" : "font-medium"}`}
                  >
                    <Link
                      href={`${BASE_PATH}/${account.id}/edit`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {account.name}
                    </Link>
                  </Td>
                  <Td>{humanizeStatus(account.type)}</Td>
                  <Td className="text-muted-foreground">
                    {account.subType ? humanizeStatus(account.subType) : "—"}
                  </Td>
                  <Td alignment="center">{account.isPostable ? "Yes" : "Header"}</Td>
                  <Td alignment="center">
                    <StatusBadge status={account.isActive ? "ACTIVE" : "DRAFT"} />
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
