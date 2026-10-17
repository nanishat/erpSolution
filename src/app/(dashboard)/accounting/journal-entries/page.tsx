import Link from "next/link";

import { JournalEntryStatus, VoucherType } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Amount } from "@/components/shared/Amount";
import { Card } from "@/components/shared/Card";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Pagination } from "@/components/shared/Pagination";
import { StatusBadge, humanizeStatus } from "@/components/shared/StatusBadge";
import { TableBox, Td, Th, tableRowClassName } from "@/components/shared/TableBox";
import { buildQueryString, parseListParams, type ListSearchParams } from "@/lib/list-params";
import { VOUCHER_TYPE_LABELS } from "@/modules/accounting/constants/voucher-type";
import { getPaginatedJournalEntries } from "@/modules/accounting/services/journal-entry.service";

export const dynamic = "force-dynamic";

type JournalEntriesSearchParams = ListSearchParams & {
  status?: string | string[];
  voucherType?: string | string[];
  dateFrom?: string | string[];
  dateTo?: string | string[];
};

const JOURNAL_ENTRY_STATUSES: JournalEntryStatus[] = ["DRAFT", "POSTED", "VOID"];
const VOUCHER_TYPES: VoucherType[] = [
  "DEBIT_VOUCHER",
  "CREDIT_VOUCHER",
  "JOURNAL_VOUCHER",
  "CASH_VOUCHER",
  "INVOICE_VOUCHER",
  "PAYMENT_VOUCHER",
];

function getSingleValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function parseDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return undefined;
  return date;
}

function getEnumValue<T extends string>(value: string | undefined, allowed: T[]) {
  return allowed.find((candidate) => candidate === value);
}

function formatVoucherType(voucherType: VoucherType) {
  return VOUCHER_TYPE_LABELS[voucherType];
}

export default async function JournalEntriesPage({
  searchParams,
}: {
  searchParams: Promise<JournalEntriesSearchParams>;
}) {
  const params = await searchParams;
  const listParams = parseListParams(params);
  const status = getEnumValue(getSingleValue(params.status), JOURNAL_ENTRY_STATUSES);
  const voucherType = getEnumValue(getSingleValue(params.voucherType), VOUCHER_TYPES);
  const dateFrom = parseDate(getSingleValue(params.dateFrom));
  const dateTo = parseDate(getSingleValue(params.dateTo));
  const { items, total, page } = await getPaginatedJournalEntries({
    ...listParams,
    status,
    voucherType,
    dateFrom,
    dateTo,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vouchers"
        description="Record and review journal entries."
        actions={
          <>
            <Link
              href="/accounting/chart-of-accounts"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Chart of Accounts →
            </Link>
            <Link
              href="/accounting/reports/trial-balance"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Trial Balance →
            </Link>
            <Button asChild>
              <Link href="/accounting/journal-entries/new">New Voucher</Link>
            </Button>
          </>
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
              placeholder="Voucher number or description"
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
              {JOURNAL_ENTRY_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {humanizeStatus(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>Voucher type</span>
            <select
              name="voucherType"
              defaultValue={voucherType ?? ""}
              className="w-full rounded-md border border-input bg-background px-3 py-2"
            >
              <option value="">All voucher types</option>
              {VOUCHER_TYPES.map((value) => (
                <option key={value} value={value}>
                  {formatVoucherType(value)}
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
        title="Vouchers"
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
          <EmptyState title="No vouchers found" description="Try changing the filters." />
        ) : (
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr>
                <Th>Voucher No</Th>
                <Th alignment="center">Date</Th>
                <Th>Type</Th>
                <Th>Description</Th>
                <Th alignment="right">Amount</Th>
                <Th alignment="center">Status</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr key={entry.id} className={tableRowClassName}>
                  <Td className="font-medium">
                    <Link
                      href={`/accounting/journal-entries/${entry.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {entry.documentNumber}
                    </Link>
                  </Td>
                  <Td alignment="center">{entry.date.toLocaleDateString()}</Td>
                  <Td>{formatVoucherType(entry.voucherType)}</Td>
                  <Td className="max-w-0">
                    <span className="block truncate" title={entry.description}>
                      {entry.description}
                    </span>
                  </Td>
                  <Td alignment="right">
                    <Amount value={entry.amount} />
                  </Td>
                  <Td alignment="center">
                    <StatusBadge status={entry.status} />
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
