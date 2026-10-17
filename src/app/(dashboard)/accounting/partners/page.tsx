import Link from "next/link";

import { Amount } from "@/components/shared/Amount";
import { Card } from "@/components/shared/Card";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Pagination } from "@/components/shared/Pagination";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TableBox, Td, Th, tableRowClassName } from "@/components/shared/TableBox";
import { Button } from "@/components/ui/button";
import { buildQueryString, parseListParams, type ListSearchParams } from "@/lib/list-params";
import { getPaginatedPartners } from "@/modules/partners/services/partner.service";

// Partner data must always be read fresh — never statically prerendered/cached.
export const dynamic = "force-dynamic";

type PartnersSearchParams = ListSearchParams & {
  type?: string | string[];
  isActive?: string | string[];
};

function getSingleValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function getPartnerType(value: string | undefined) {
  return value === "CUSTOMER" || value === "VENDOR" ? value : undefined;
}

function getActiveFilter(value: string | undefined): boolean | "all" {
  if (value === "false") return false;
  if (value === "all") return "all";
  return true;
}

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<PartnersSearchParams>;
}) {
  const params = await searchParams;
  const listParams = parseListParams(params);
  const type = getPartnerType(getSingleValue(params.type));
  const isActive = getActiveFilter(getSingleValue(params.isActive));
  const { items, total, page } = await getPaginatedPartners({
    ...listParams,
    type,
    isActive,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Partners"
        description="Customers and vendors used across accounting and procurement."
        actions={
          <Button asChild>
            <Link href="/accounting/partners/new">New Partner</Link>
          </Button>
        }
      />

      <Card>
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <input type="hidden" name="pageSize" value={listParams.pageSize} />
          <label className="space-y-1 text-sm lg:col-span-3">
            <span>Search</span>
            <input
              type="search"
              name="search"
              defaultValue={listParams.search}
              placeholder="Name, TIN, or BIN"
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
              <option value="CUSTOMER">Customer</option>
              <option value="VENDOR">Vendor</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>Status</span>
            <select
              name="isActive"
              defaultValue={isActive === "all" ? "all" : String(isActive)}
              className="w-full rounded-md border border-input bg-background px-3 py-2"
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
              <option value="all">All statuses</option>
            </select>
          </label>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              Apply
            </button>
            <Link
              href={buildQueryString({}, { pageSize: String(listParams.pageSize) })}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              Clear
            </Link>
          </div>
        </form>
      </Card>

      <TableBox
        title="Partners"
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
          <EmptyState title="No partners found" description="Try changing the filters." />
        ) : (
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th alignment="center">Type</Th>
                <Th>Contact</Th>
                <Th>TIN</Th>
                <Th alignment="right">Balance</Th>
                <Th alignment="center">Status</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((partner) => {
                const contactDetails = [partner.phone, partner.email].filter(Boolean).join(" · ");
                const balance =
                  partner.type === "CUSTOMER"
                    ? partner.outstandingBalance
                    : partner.payableBalance;

                return (
                  <tr key={partner.id} className={tableRowClassName}>
                    <Td className="font-medium">
                      <Link
                        href={`/accounting/partners/${partner.id}/edit`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {partner.name}
                      </Link>
                    </Td>
                    <Td alignment="center">{partner.type === "CUSTOMER" ? "Customer" : "Vendor"}</Td>
                    <Td>
                      <div>{partner.contactPerson ?? "—"}</div>
                      {contactDetails && (
                        <div className="text-xs text-muted-foreground">{contactDetails}</div>
                      )}
                    </Td>
                    <Td>{partner.tin}</Td>
                    <Td alignment="right">
                      <div>
                        <Amount value={balance} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {partner.type === "CUSTOMER" ? "Receivable" : "Payable"}
                      </div>
                    </Td>
                    <Td alignment="center">
                      <StatusBadge
                        status={partner.isActive ? "ACTIVE" : "DRAFT"}
                        label={partner.isActive ? "Active" : "Inactive"}
                      />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableBox>
    </div>
  );
}
