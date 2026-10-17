import Link from "next/link";
import { TaxDirection } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/shared/Card";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Pagination } from "@/components/shared/Pagination";
import { StatusBadge, humanizeStatus } from "@/components/shared/StatusBadge";
import { TableBox, Td, Th, tableRowClassName } from "@/components/shared/TableBox";
import { buildQueryString, parseListParams, type ListSearchParams } from "@/lib/list-params";
import { getPaginatedTaxRates } from "@/modules/tax/services/tax-rate.service";
import { TaxRateDeactivateButton } from "@/modules/tax/components/TaxRateDeactivateButton";
import { listTaxRatesQuerySchema } from "@/modules/tax/validations/tax-rate.schema";

export const dynamic = "force-dynamic";

const BASE_PATH = "/accounting/tax-rates";
const TAX_DIRECTIONS: TaxDirection[] = ["INPUT", "OUTPUT"];
type SearchParams = ListSearchParams & {
  direction?: string | string[];
  isActive?: string | string[];
};

function getSingleValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function TaxRatesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const listParams = parseListParams(params);
  const parsedDirection = listTaxRatesQuerySchema.shape.direction.safeParse(
    getSingleValue(params.direction)
  );
  const parsedActive = listTaxRatesQuerySchema.shape.isActive.safeParse(
    getSingleValue(params.isActive)
  );
  const direction = parsedDirection.success ? parsedDirection.data : undefined;
  const isActive = parsedActive.success ? (parsedActive.data ?? true) : true;
  const activeValue = isActive === "all" ? "all" : String(isActive);
  const { items, total, page } = await getPaginatedTaxRates({
    ...listParams,
    direction,
    isActive,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tax Rates"
        description="Admin-maintained VAT rate list used when applying tax to a transaction."
        actions={
          <Button asChild>
            <Link href={`${BASE_PATH}/new`}>New Tax Rate</Link>
          </Button>
        }
      />

      <Card>
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input type="hidden" name="pageSize" value={listParams.pageSize} />
          <label className="space-y-1 text-sm">
            <span>Direction</span>
            <select
              name="direction"
              defaultValue={direction ?? ""}
              className="w-full rounded-md border border-input bg-background px-3 py-2"
            >
              <option value="">All directions</option>
              {TAX_DIRECTIONS.map((value) => (
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
        title="Tax Rates"
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
          <EmptyState title="No tax rates found" description="Try changing the filters." />
        ) : (
          <table className="w-full min-w-[680px] border-collapse">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th alignment="center">Direction</Th>
                <Th alignment="right">Rate %</Th>
                <Th alignment="center">Effective From</Th>
                <Th alignment="center">Status</Th>
                <Th alignment="center">Action</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((rate) => (
                <tr key={rate.id} className={tableRowClassName}>
                  <Td>{rate.name}</Td>
                  <Td alignment="center">{humanizeStatus(rate.direction)}</Td>
                  <Td alignment="right" className="tabular-nums">
                    {rate.ratePercent.toFixed(2)}
                  </Td>
                  <Td alignment="center">{rate.effectiveFrom.toLocaleDateString()}</Td>
                  <Td alignment="center">
                    <StatusBadge status={rate.isActive ? "ACTIVE" : "INACTIVE"} />
                  </Td>
                  <Td alignment="center">
                    {rate.isActive && <TaxRateDeactivateButton id={rate.id} name={rate.name} />}
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
