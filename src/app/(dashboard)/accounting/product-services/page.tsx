import Link from "next/link";
import { ProductServiceType } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Amount } from "@/components/shared/Amount";
import { Card } from "@/components/shared/Card";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Pagination } from "@/components/shared/Pagination";
import { StatusBadge, humanizeStatus } from "@/components/shared/StatusBadge";
import { TableBox, Td, Th, tableRowClassName } from "@/components/shared/TableBox";
import { buildQueryString, parseListParams, type ListSearchParams } from "@/lib/list-params";
import { getPaginatedProductServices } from "@/modules/products/services/product-service.service";
import { listProductServicesQuerySchema } from "@/modules/products/validations/product-service.schema";

export const dynamic = "force-dynamic";

const BASE_PATH = "/accounting/product-services";
const PRODUCT_SERVICE_TYPES: ProductServiceType[] = ["PRODUCT", "SERVICE"];
type SearchParams = ListSearchParams & {
  type?: string | string[];
  isActive?: string | string[];
};

function getSingleValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function ProductServicesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const listParams = parseListParams(params);
  const parsedType = listProductServicesQuerySchema.shape.type.safeParse(
    getSingleValue(params.type)
  );
  const parsedActive = listProductServicesQuerySchema.shape.isActive.safeParse(
    getSingleValue(params.isActive)
  );
  const type = parsedType.success ? parsedType.data : undefined;
  const isActive = parsedActive.success ? (parsedActive.data ?? true) : true;
  const activeValue = isActive === "all" ? "all" : String(isActive);
  const { items, total, page } = await getPaginatedProductServices({
    ...listParams,
    type,
    isActive,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products & Services"
        description="Billable catalog used on invoice lines, mapped to income/expense accounts."
        actions={
          <Button asChild>
            <Link href={`${BASE_PATH}/new`}>New Product / Service</Link>
          </Button>
        }
      />

      <Card>
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input type="hidden" name="pageSize" value={listParams.pageSize} />
          <label className="space-y-1 text-sm lg:col-span-2">
            <span>Search</span>
            <input
              type="search"
              name="search"
              defaultValue={listParams.search}
              placeholder="Name or code"
              className="w-full rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span>Type</span>
            <select
              name="type"
              defaultValue={type ?? ""}
              className="w-full rounded-md border border-input bg-background px-3 py-2"
            >
              <option value="">All types</option>
              {PRODUCT_SERVICE_TYPES.map((value) => (
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
        title="Products & Services"
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
          <EmptyState
            title="No products or services found"
            description="Try changing the filters."
          />
        ) : (
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th alignment="right">Default Price</Th>
                <Th>Income/Expense Account</Th>
                <Th alignment="center">Status</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={tableRowClassName}>
                  <Td className="font-medium">
                    <Link
                      href={`${BASE_PATH}/${item.id}/edit`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {item.name}
                    </Link>
                  </Td>
                  <Td>{humanizeStatus(item.type)}</Td>
                  <Td alignment="right">
                    <Amount value={item.unitPrice} />
                  </Td>
                  <Td className="text-muted-foreground">
                    {`${item.incomeAccount.code} — ${item.incomeAccount.name}`}
                    {item.expenseAccount &&
                      ` / ${item.expenseAccount.code} — ${item.expenseAccount.name}`}
                  </Td>
                  <Td alignment="center">
                    <StatusBadge status={item.isActive ? "ACTIVE" : "INACTIVE"} />
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
