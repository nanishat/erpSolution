"use client";

import { useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import type { InvoiceDirection } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Amount } from "@/components/shared/Amount";
import { toPaisa } from "@/components/shared/BalanceSummary";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";
import type { BranchOption } from "@/modules/core/services/branch.service";
import { createInvoiceSchema } from "@/modules/invoicing/validations/invoice.schema";
import type { Partner } from "@/modules/partners/services/partner.service";
import type { ProductServiceWithAccounts } from "@/modules/products/services/product-service.service";
import Link from "next/link";

type LineRow = {
  key: string;
  productServiceId: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

function emptyLine(): LineRow {
  return { key: crypto.randomUUID(), productServiceId: "", description: "", quantity: "1", unitPrice: "0" };
}

/**
 * Shared create form for both Customer Invoices (direction: CUSTOMER) and
 * Vendor Bills (direction: VENDOR) — the `direction` prop drives the two
 * real differences between them: createInvoiceSchema's `sector` field only
 * exists on the CUSTOMER branch of its discriminated union (hidden for
 * VENDOR), and only ProductService rows with a non-null expenseAccountId are
 * selectable for VENDOR lines (see selectableProductServices below).
 * Everything else — partner/branch/line-item plumbing — is identical.
 * `partners`/`productServices` are pre-filtered by the caller (partner.type,
 * active-only) rather than filtered here, same convention as
 * CashBankVoucherForm receiving pre-fetched accounts/branches.
 *
 * Tax is deliberately not part of this form — grandTotal isn't final until
 * tax is attached afterward via the existing AddTaxApplicationForm flow
 * against this invoice's JournalEntry (see createInvoice's doc comment) —
 * only the live subtotal is shown here.
 */
export function InvoiceForm({
  direction,
  partners,
  branches,
  productServices,
  basePath,
}: {
  direction: InvoiceDirection;
  partners: Partner[];
  branches: BranchOption[];
  productServices: ProductServiceWithAccounts[];
  basePath: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const [partnerId, setPartnerId] = useState("");
  const [sector, setSector] = useState("");
  const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0].id : "");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);
  const gridRef = useRef<HTMLDivElement>(null);
  const [initialValues] = useState(
    () => JSON.stringify({ partnerId, sector, branchId, date, dueDate, notes, lines })
  );
  const isDirty =
    JSON.stringify({ partnerId, sector, branchId, date, dueDate, notes, lines }) !== initialValues;
  const { markSubmitted } = useUnsavedChangesWarning(isDirty);

  const updateLine = (key: string, patch: Partial<LineRow>) => {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const handleProductServiceChange = (key: string, productServiceId: string) => {
    const productService = selectableProductServices.find((p) => p.id === productServiceId);
    updateLine(key, {
      productServiceId,
      description: productService?.name ?? "",
      unitPrice: productService ? productService.unitPrice.toFixed(2) : "0",
    });
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (key: string) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((line) => line.key !== key)));

  // direction: VENDOR lines resolve their debit account via
  // ProductService.expenseAccountId (see createInvoice) — a row without one
  // set is rejected server-side (InvoiceLineMissingExpenseAccountError).
  // Filtering it out of the dropdown here avoids a submit-then-reject round
  // trip; the server check remains the actual enforcement. direction:
  // CUSTOMER has no equivalent restriction (every ProductService has a
  // required incomeAccountId), so the full list is offered as-is.
  const selectableProductServices =
    direction === "VENDOR"
      ? productServices.filter((productService) => productService.expenseAccountId != null)
      : productServices;

  const lineTotalPaisa = (line: LineRow) =>
    toPaisa((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0));
  const subtotalPaisa = lines.reduce((sum, line) => sum + lineTotalPaisa(line), 0);

  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter") return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.hasAttribute("data-line-cell")) return;
    const cells = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-line-cell]"));
    const cellIndex = cells.indexOf(target);
    if (cellIndex < 0) return;

    event.preventDefault();
    if (cellIndex < cells.length - 1) {
      cells[cellIndex + 1].focus();
      return;
    }

    const nextRowIndex = lines.length;
    addLine();
    requestAnimationFrame(() => {
      gridRef.current
        ?.querySelector<HTMLElement>(`[data-line-row="${nextRowIndex}"] [data-line-cell]`)
        ?.focus();
    });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const basePayload = {
      partnerId,
      branchId,
      date: date ? new Date(date) : undefined,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      notes: notes || undefined,
      lines: lines.map((line) => ({
        productServiceId: line.productServiceId || undefined,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
    };

    const payload =
      direction === "CUSTOMER"
        ? { ...basePayload, direction: "CUSTOMER" as const, sector }
        : { ...basePayload, direction: "VENDOR" as const };

    const parsed = createInvoiceSchema.safeParse(payload);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Please fix the errors below.");
      return;
    }

    startTransition(async () => {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const json = await res.json();

      if (!res.ok) {
        setFormError(json.error ?? "Failed to create invoice.");
        return;
      }

      markSubmitted();
      router.push(`${basePath}/${json.data.id}`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={direction === "CUSTOMER" ? "New Customer Invoice" : "New Vendor Bill"}
        description={
          direction === "CUSTOMER"
            ? "Create an invoice for a customer; add tax from the invoice detail page after saving."
            : "Record a bill from a vendor; add tax from the bill detail page after saving."
        }
      />
      <form onSubmit={onSubmit} className="space-y-6">
      {formError && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </div>
      )}
      <Card title="Basic Details">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="partnerId">Partner *</label>
          {partners.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              No partners available. <Link className="underline" href="/accounting/partners">Create one</Link>.
            </p>
          ) : (
            <select
              id="partnerId"
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              <option value="" disabled>Select partner</option>
              {partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
            </select>
          )}
        </div>
        {direction === "CUSTOMER" && (
          <div>
            <label className="text-sm font-medium" htmlFor="sector">Sector *</label>
            <input
              id="sector"
              type="text"
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">Used to identify this invoice category.</p>
          </div>
        )}
        <div>
          <label className="text-sm font-medium" htmlFor="branchId">Branch *</label>
          <select
            id="branchId"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="" disabled>
              Select branch
            </option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="date">Date *</label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="dueDate">Due date</label>
          <input
            id="dueDate"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </div>
      </div>
      </Card>

      <Card title="Items">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Add the products or services on this document.</p>
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            Add line
          </Button>
        </div>
        {selectableProductServices.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No products or services are available. <Link className="underline" href="/accounting/product-services">Create one</Link>.
          </p>
        )}
        <div ref={gridRef} onKeyDown={handleGridKeyDown} className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Product/Service *</th>
                <th className="px-3 py-2">Description *</th>
                <th className="px-3 py-2 text-right">Qty *</th>
                <th className="px-3 py-2 text-right">Unit price *</th>
                <th className="px-3 py-2 text-right">Line total</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={line.key} data-line-row={index} className="border-t border-border">
                  <td className="px-3 py-2">
                    <select
                      value={line.productServiceId}
                      onChange={(e) => handleProductServiceChange(line.key, e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      data-line-cell
                    >
                      <option value="">Custom line</option>
                      {selectableProductServices.map((productService) => (
                        <option key={productService.id} value={productService.id}>
                          {productService.code} — {productService.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={line.description}
                      onChange={(e) => updateLine(line.key, { description: e.target.value })}
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      data-line-cell
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={line.quantity}
                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                      className="w-24 rounded-md border border-input bg-background px-2 py-1.5 text-right text-sm tabular-nums"
                      data-line-cell
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={line.unitPrice}
                      onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                      className="w-28 rounded-md border border-input bg-background px-2 py-1.5 text-right text-sm tabular-nums"
                      data-line-cell
                    />
                  </td>
                  <td className="px-3 py-2 text-right"><Amount value={lineTotalPaisa(line) / 100} /></td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={lines.length === 1}
                      aria-label={`Remove item ${index + 1}`}
                      onClick={() => removeLine(line.key)}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end">
        <Card title="Summary" className="w-full sm:max-w-md">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="font-medium tabular-nums"><Amount value={subtotalPaisa / 100} /></dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">VAT</dt><dd className="text-muted-foreground">Added after saving</dd></div>
            <div className="flex justify-between border-t border-border pt-3 text-base font-semibold"><dt>Total <span className="text-xs font-normal text-muted-foreground">(before VAT)</span></dt><dd className="tabular-nums"><Amount value={subtotalPaisa / 100} /></dd></div>
          </dl>
        </Card>
      </div>
      </Card>

      <Card title="Notes">
        <div>
          <label className="text-sm font-medium" htmlFor="notes">Notes</label>
          <input
            id="notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </div>
      </Card>

      <div className="flex items-center gap-4 border-t border-border pt-4">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : "Save as Draft"}
        </Button>
        <Link href={basePath} className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Cancel
        </Link>
      </div>
      </form>
    </div>
  );
}
