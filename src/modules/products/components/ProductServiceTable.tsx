"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProductServiceType } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProductServiceWithAccounts } from "@/modules/products/services/product-service.service";

export function ProductServiceTable({
  productServices,
}: {
  productServices: ProductServiceWithAccounts[];
}) {
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState<ProductServiceType | "">("");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [search, setSearch] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const filtered = productServices.filter((productService) => {
    if (typeFilter && productService.type !== typeFilter) return false;
    if (activeFilter === "active" && !productService.isActive) return false;
    if (activeFilter === "inactive" && productService.isActive) return false;
    if (search) {
      const q = search.toLowerCase();
      const matches =
        productService.code.toLowerCase().includes(q) ||
        productService.name.toLowerCase().includes(q);
      if (!matches) return false;
    }
    return true;
  });

  const handleDeactivate = async (productService: ProductServiceWithAccounts) => {
    if (!window.confirm(`Deactivate "${productService.name}"?`)) return;
    setPendingId(productService.id);
    try {
      const res = await fetch(`/api/product-services/${productService.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        window.alert(json?.error ?? "Failed to deactivate product/service.");
        return;
      }
      router.refresh();
    } finally {
      setPendingId(null);
    }
  };

  if (productServices.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No products or services yet — create one to get started.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="text-sm font-medium" htmlFor="type-filter">
            Type
          </label>
          <select
            id="type-filter"
            className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as ProductServiceType | "")}
          >
            <option value="">All types</option>
            <option value="PRODUCT">PRODUCT</option>
            <option value="SERVICE">SERVICE</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="active-filter">
            Status
          </label>
          <select
            id="active-filter"
            className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={activeFilter}
            onChange={(e) =>
              setActiveFilter(e.target.value as "all" | "active" | "inactive")
            }
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="search">
            Search
          </label>
          <input
            id="search"
            type="text"
            placeholder="Code or name"
            className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No products or services match these filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Unit price</th>
                <th className="px-3 py-2">Unit</th>
                <th className="px-3 py-2">Income account</th>
                <th className="px-3 py-2">Expense account</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((productService) => (
                <tr
                  key={productService.id}
                  className={cn(
                    "border-t border-border",
                    !productService.isActive && "opacity-50"
                  )}
                >
                  <td className="px-3 py-2">{productService.code}</td>
                  <td className="px-3 py-2">{productService.name}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-xs font-medium",
                        productService.type === "PRODUCT"
                          ? "bg-primary/10 text-primary"
                          : "bg-secondary text-secondary-foreground"
                      )}
                    >
                      {productService.type}
                    </span>
                  </td>
                  <td className="px-3 py-2">{productService.unitPrice.toString()}</td>
                  <td className="px-3 py-2">{productService.unit ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {productService.incomeAccount.code} — {productService.incomeAccount.name}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {productService.expenseAccount
                      ? `${productService.expenseAccount.code} — ${productService.expenseAccount.name}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {productService.isActive ? "Active" : "Inactive"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/accounting/product-services/${productService.id}/edit`}
                      className="text-sm text-primary underline-offset-4 hover:underline"
                    >
                      Edit
                    </Link>
                    {productService.isActive && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="ml-2"
                        disabled={pendingId === productService.id}
                        onClick={() => handleDeactivate(productService)}
                      >
                        Deactivate
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
