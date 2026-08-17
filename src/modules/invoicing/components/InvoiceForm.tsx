"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { InvoiceDirection } from "@prisma/client";

import { Button } from "@/components/ui/button";
import type { BranchOption } from "@/modules/core/services/branch.service";
import { createInvoiceSchema } from "@/modules/invoicing/validations/invoice.schema";
import type { Partner } from "@/modules/partners/services/partner.service";
import type { ProductServiceWithAccounts } from "@/modules/products/services/product-service.service";

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

  const lineTotal = (line: LineRow) => (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);

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

      router.push(`${basePath}/${json.data.id}`);
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-border p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="text-sm font-medium" htmlFor="partnerId">
            Partner
          </label>
          <select
            id="partnerId"
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="" disabled>
              Select partner
            </option>
            {partners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.name}
              </option>
            ))}
          </select>
        </div>
        {direction === "CUSTOMER" && (
          <div>
            <label className="text-sm font-medium" htmlFor="sector">
              Sector
            </label>
            <input
              id="sector"
              type="text"
              placeholder="e.g. GS, CC"
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </div>
        )}
        <div>
          <label className="text-sm font-medium" htmlFor="branchId">
            Branch
          </label>
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
                {branch.name} ({branch.code})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="date">
            Date
          </label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="dueDate">
            Due date
          </label>
          <input
            id="dueDate"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="notes">
          Notes
        </label>
        <input
          id="notes"
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Line items</span>
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            Add line
          </Button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Product/Service</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit price</th>
                <th className="px-3 py-2 text-right">Line total</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.key} className="border-t border-border">
                  <td className="px-3 py-2">
                    <select
                      value={line.productServiceId}
                      onChange={(e) => handleProductServiceChange(line.key, e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
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
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.quantity}
                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                      className="w-24 rounded-md border border-input bg-background px-2 py-1.5 text-right text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.unitPrice}
                      onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                      className="w-28 rounded-md border border-input bg-background px-2 py-1.5 text-right text-sm"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">{lineTotal(line).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={lines.length === 1}
                      onClick={() => removeLine(line.key)}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-medium">
                <td className="px-3 py-2" colSpan={4}>
                  Subtotal
                </td>
                <td className="px-3 py-2 text-right">{subtotal.toFixed(2)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : direction === "CUSTOMER" ? "Create invoice" : "Create bill"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push(basePath)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
