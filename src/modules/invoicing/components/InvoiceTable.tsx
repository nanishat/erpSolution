"use client";

import { useState } from "react";
import Link from "next/link";
import type { InvoiceStatus } from "@prisma/client";

import { InvoiceStatusBadge } from "@/modules/invoicing/components/InvoiceStatusBadge";
import type { InvoiceWithLines } from "@/modules/invoicing/services/invoice.service";
import type { Partner } from "@/modules/partners/services/partner.service";

const STATUS_OPTIONS: InvoiceStatus[] = [
  "DRAFT",
  "POSTED",
  "PARTIALLY_PAID",
  "PAID",
  "CANCELLED",
  "VOID",
];

/**
 * Shared list table for both Customer Invoices (direction: CUSTOMER, this
 * task) and the future Vendor Bill list (direction: VENDOR) — the caller
 * decides which slice of Invoice to fetch (via getInvoices({ direction }))
 * and which detail route to link into (via basePath); this component itself
 * has no direction-specific logic beyond the `partners` filter dropdown,
 * which the caller already scoped by partner type when it fetched them.
 */
export function InvoiceTable({
  invoices,
  partners,
  basePath,
}: {
  invoices: InvoiceWithLines[];
  partners: Partner[];
  basePath: string;
}) {
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "">("");
  const [partnerFilter, setPartnerFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filtered = invoices.filter((invoice) => {
    if (statusFilter && invoice.status !== statusFilter) return false;
    if (partnerFilter && invoice.partnerId !== partnerFilter) return false;
    if (dateFrom && invoice.date < new Date(dateFrom)) return false;
    if (dateTo && invoice.date > new Date(`${dateTo}T23:59:59.999`)) return false;
    return true;
  });

  if (invoices.length === 0) {
    return <p className="text-sm text-muted-foreground">No invoices yet — create one to get started.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="text-sm font-medium" htmlFor="status-filter">
            Status
          </label>
          <select
            id="status-filter"
            className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as InvoiceStatus | "")}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="partner-filter">
            Partner
          </label>
          <select
            id="partner-filter"
            className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={partnerFilter}
            onChange={(e) => setPartnerFilter(e.target.value)}
          >
            <option value="">All partners</option>
            {partners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="date-from">
            From
          </label>
          <input
            id="date-from"
            type="date"
            className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="date-to">
            To
          </label>
          <input
            id="date-to"
            type="date"
            className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No invoices match these filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Invoice #</th>
                <th className="px-3 py-2">Partner</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Due date</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Grand total</th>
                <th className="px-3 py-2 text-right">Paid</th>
                <th className="px-3 py-2 text-right">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((invoice) => {
                const remaining = invoice.grandTotal - invoice.amountPaid;
                return (
                  <tr key={invoice.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link
                        href={`${basePath}/${invoice.id}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {invoice.invoiceNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{invoice.partner.name}</td>
                    <td className="px-3 py-2">{invoice.date.toLocaleDateString()}</td>
                    <td className="px-3 py-2">
                      {invoice.dueDate ? invoice.dueDate.toLocaleDateString() : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <InvoiceStatusBadge status={invoice.status} />
                    </td>
                    <td className="px-3 py-2 text-right">{invoice.grandTotal.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{invoice.amountPaid.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{remaining.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
