"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { ProductServiceType } from "@prisma/client";

import { Button } from "@/components/ui/button";
import type { ChartOfAccountOption } from "@/modules/accounting/types/journal-entry.types";
import type { ProductServiceWithAccounts } from "@/modules/products/services/product-service.service";
import {
  createProductServiceSchema,
  updateProductServiceSchema,
} from "@/modules/products/validations/product-service.schema";

type ProductServiceFormValues = {
  code: string;
  name: string;
  description: string;
  type: ProductServiceType | "";
  unitPrice: string;
  unit: string;
  incomeAccountId: string;
  expenseAccountId: string;
  isActive: boolean;
};

export function ProductServiceForm({
  mode,
  productService,
  accounts,
}: {
  mode: "create" | "edit";
  productService?: ProductServiceWithAccounts;
  accounts: ChartOfAccountOption[];
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ProductServiceFormValues>({
    defaultValues: {
      code: productService?.code ?? "",
      name: productService?.name ?? "",
      description: productService?.description ?? "",
      type: productService?.type ?? "",
      unitPrice: productService?.unitPrice?.toFixed(2) ?? "0",
      unit: productService?.unit ?? "",
      incomeAccountId: productService?.incomeAccountId ?? "",
      expenseAccountId: productService?.expenseAccountId ?? "",
      isActive: productService?.isActive ?? true,
    },
  });

  const onSubmit = async (values: ProductServiceFormValues) => {
    setFormError(null);

    const isCreate = mode === "create";
    // create sends `undefined` to omit an optional field entirely; edit sends
    // `null` to explicitly clear it — matching the nullable().optional() shape
    // of updateProductServiceSchema vs the plain .optional() shape of
    // createProductServiceSchema.
    const nullish = isCreate ? undefined : null;

    const payload: Record<string, unknown> = {
      code: values.code,
      name: values.name,
      description: values.description || nullish,
      type: values.type,
      unitPrice: values.unitPrice,
      unit: values.unit || nullish,
      incomeAccountId: values.incomeAccountId,
      expenseAccountId: values.expenseAccountId || nullish,
    };

    if (!isCreate) {
      payload.isActive = values.isActive;
    }

    const schema = isCreate ? createProductServiceSchema : updateProductServiceSchema;
    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && field in values) {
          setError(field as keyof ProductServiceFormValues, { message: issue.message });
        }
      }
      setFormError(parsed.error.issues[0]?.message ?? "Please fix the errors below.");
      return;
    }

    setIsPending(true);
    try {
      const res = await fetch(
        isCreate ? "/api/product-services" : `/api/product-services/${productService!.id}`,
        {
          method: isCreate ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        }
      );
      const json = await res.json();

      if (!res.ok) {
        setFormError(json.error ?? "Failed to save product/service.");
        return;
      }

      router.push("/accounting/product-services");
      router.refresh();
    } catch {
      setFormError("Failed to save product/service.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-lg border border-border p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="code">
            Code
          </label>
          <input
            id="code"
            type="text"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("code")}
          />
          {errors.code && <p className="mt-1 text-xs text-destructive">{errors.code.message}</p>}
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="name">
            Name
          </label>
          <input
            id="name"
            type="text"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("name")}
          />
          {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="description">
          Description
        </label>
        <input
          id="description"
          type="text"
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          {...register("description")}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="type">
            Type
          </label>
          <select
            id="type"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("type")}
          >
            <option value="" disabled>
              Select type
            </option>
            {Object.values(ProductServiceType).map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          {errors.type && <p className="mt-1 text-xs text-destructive">{errors.type.message}</p>}
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="unit">
            Unit
          </label>
          <input
            id="unit"
            type="text"
            placeholder="per hour, per guard/month, ..."
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("unit")}
          />
        </div>
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="unitPrice">
          Unit price
        </label>
        <input
          id="unitPrice"
          type="number"
          step="0.01"
          min={0}
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          {...register("unitPrice")}
        />
        {errors.unitPrice && (
          <p className="mt-1 text-xs text-destructive">{errors.unitPrice.message}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="incomeAccountId">
            Income account
          </label>
          <select
            id="incomeAccountId"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("incomeAccountId")}
          >
            <option value="" disabled>
              Select income account
            </option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.name}
              </option>
            ))}
          </select>
          {errors.incomeAccountId && (
            <p className="mt-1 text-xs text-destructive">{errors.incomeAccountId.message}</p>
          )}
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="expenseAccountId">
            Expense account
          </label>
          <select
            id="expenseAccountId"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("expenseAccountId")}
          >
            <option value="">None</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.name}
              </option>
            ))}
          </select>
          {errors.expenseAccountId && (
            <p className="mt-1 text-xs text-destructive">{errors.expenseAccountId.message}</p>
          )}
        </div>
      </div>

      {mode === "edit" && (
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" {...register("isActive")} />
          Active
        </label>
      )}

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending
            ? "Saving..."
            : mode === "create"
              ? "Create product/service"
              : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/accounting/product-services")}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
