import Link from "next/link";

import { InvoiceStatus } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Amount } from "@/components/shared/Amount";
import { Card } from "@/components/shared/Card";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Pagination } from "@/components/shared/Pagination";
import { StatusBadge, humanizeStatus } from "@/components/shared/StatusBadge";
import { TableBox, Td, Th, tableRowClassName } from "@/components/shared/TableBox";
import { buildQueryString, parseListParams, type ListSearchParams } from "@/lib/list-params";
import { getPaginatedInvoices } from "@/modules/invoicing/services/invoice.service";
import { listPartners } from "@/modules/partners/services/partner.service";

// Ledger data must always be read fresh — never statically prerendered/cached.
export const dynamic = "force-dynamic";

const BASE_PATH = "/accounting/invoices";
const INVOICE_STATUSES: InvoiceStatus[] = [
  "DRAFT",
  "POSTED",
  "PARTIALLY_PAID",
  "PAID",
  "CANCELLED",
  "VOID",
];

type InvoiceSearchParams = ListSearchParams & {
  status?: string | string[];
  partnerId?: string | string[];
  dateFrom?: string | string[];
  dateTo?: string | string[];
};

function getSingleValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function parseDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return undefined;
  return date;
}

function getInvoiceStatus(value: string | undefined) {
  return INVOICE_STATUSES.find((status) => status === value);
}

export default async function CustomerInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<InvoiceSearchParams>;
}) {
  const params = await searchParams;
  const listParams = parseListParams(params);
  const status = getInvoiceStatus(getSingleValue(params.status));
  const partnerId = getSingleValue(params.partnerId);
  const dateFrom = parseDate(getSingleValue(params.dateFrom));
  const dateTo = parseDate(getSingleValue(params.dateTo));
  const [{ items, total, page }, partners] = await Promise.all([
    getPaginatedInvoices({
      direction: "CUSTOMER",
      ...listParams,
      status,
      partnerId,
      dateFrom,
      dateTo,
    }),
    listPartners({ type: "CUSTOMER", isActive: true }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer Invoices"
        description="Create and track invoices raised against customers."
        actions={
          <Button asChild>
            <Link href={`${BASE_PATH}/new`}>New Invoice</Link>
          </Button>
        }
      />

      <Card>
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <input type="hidden" name="pageSize" value={listParams.pageSize} />
          <label className="space-y-1 text-sm lg:col-span-2">
            <span>Search</span>
            <input
              type="search"
              name="search"
              defaultValue={listParams.search}
              placeholder="Invoice number or customer"
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
              {INVOICE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {humanizeStatus(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>Customer</span>
            <select
              name="partnerId"
              defaultValue={partnerId ?? ""}
              className="w-full rounded-md border border-input bg-background px-3 py-2"
            >
              <option value="">All customers</option>
              {partners.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>From</span>
            <input
              type="date"
              name="dateFrom"
              defaultValue={dateFrom?.toISOString().slice(0, 10)}
              className="w-full rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span>To</span>
            <input
              type="date"
              name="dateTo"
              defaultValue={dateTo?.toISOString().slice(0, 10)}
              className="w-full rounded-md border border-input bg-background px-3 py-2"
            />
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
        title="Customer Invoices"
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
          <EmptyState title="No invoices found" description="Try changing the filters." />
        ) : (
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr>
                <Th>Invoice No</Th>
                <Th alignment="center">Date</Th>
                <Th>Customer</Th>
                <Th alignment="right">Total</Th>
                <Th alignment="right">Balance Due</Th>
                <Th alignment="center">Status</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((invoice) => (
                <tr key={invoice.id} className={tableRowClassName}>
                  <Td className="font-medium">
                    <Link
                      href={`${BASE_PATH}/${invoice.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {invoice.invoiceNumber}
                    </Link>
                  </Td>
                  <Td alignment="center">{invoice.date.toLocaleDateString()}</Td>
                  <Td>{invoice.partner.name}</Td>
                  <Td alignment="right">
                    <Amount value={invoice.grandTotal} />
                  </Td>
                  <Td alignment="right">
                    <Amount value={invoice.balanceDue} />
                  </Td>
                  <Td alignment="center">
                    <StatusBadge status={invoice.status} />
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
