"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { TaxComputationType, TaxDirection, TaxType } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/shared/FieldError";
import { useFieldErrors } from "@/components/shared/useFieldErrors";
import { createTaxRateSchema } from "@/modules/tax/validations/tax-rate.schema";

type TaxRateFormValues = {
  type: TaxType | "";
  category: string;
  name: string;
  ratePercent: string;
  direction: TaxDirection | "";
  computationType: TaxComputationType | "";
  effectiveFrom: string;
  effectiveTo: string;
};

export function TaxRateForm() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { fieldErrors, showIssues, clearEditedField } = useFieldErrors();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TaxRateFormValues>({
    defaultValues: {
      type: "",
      category: "",
      name: "",
      ratePercent: "",
      direction: "",
      computationType: "",
      effectiveFrom: "",
      effectiveTo: "",
    },
  });

  const onSubmit = async (values: TaxRateFormValues) => {
    setFormError(null);

    const payload = {
      type: values.type,
      category: values.category,
      name: values.name,
      ratePercent: values.ratePercent,
      direction: values.direction,
      computationType: values.computationType || undefined,
      effectiveFrom: values.effectiveFrom || undefined,
      effectiveTo: values.effectiveTo || undefined,
    };

    const parsed = createTaxRateSchema.safeParse(payload);

    if (!parsed.success) {
      showIssues(parsed.error.issues);
      return;
    }

    setIsPending(true);
    try {
      const res = await fetch("/api/tax-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const json = await res.json();

      if (!res.ok) {
        setFormError(json.error ?? "Failed to save tax rate.");
        return;
      }

      router.push("/accounting/tax-rates");
      router.refresh();
    } catch {
      setFormError("Failed to save tax rate.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      onChange={clearEditedField}
      className="space-y-4 rounded-lg border border-border p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="type">
            Type *
          </label>
          <select
            id="type"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("type")}
          >
            <option value="" disabled>
              Select type
            </option>
            {Object.values(TaxType).map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <FieldError message={fieldErrors.type ?? errors.type?.message} />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="direction">
            Direction *
          </label>
          <select
            id="direction"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("direction")}
          >
            <option value="" disabled>
              Select direction
            </option>
            {Object.values(TaxDirection).map((direction) => (
              <option key={direction} value={direction}>
                {direction}
              </option>
            ))}
          </select>
          <FieldError message={fieldErrors.direction ?? errors.direction?.message} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="category">
            Category *
          </label>
          <input
            id="category"
            type="text"
            placeholder="Standard, Exempt, ..."
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("category")}
          />
          <FieldError message={fieldErrors.category ?? errors.category?.message} />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="name">
            Name *
          </label>
          <input
            id="name"
            type="text"
            placeholder="Standard VAT 15%"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("name")}
          />
          <FieldError message={fieldErrors.name ?? errors.name?.message} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="ratePercent">
            Rate % *
          </label>
          <input
            id="ratePercent"
            type="number"
            step="0.01"
            min={0}
            max={15}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("ratePercent")}
          />
          <FieldError message={fieldErrors.ratePercent ?? errors.ratePercent?.message} />
          <p className="mt-1 text-xs text-muted-foreground">Enter a rate from 0 to 15; decimals are allowed.</p>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="computationType">
            Computation type
          </label>
          <select
            id="computationType"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("computationType")}
          >
            <option value="">Default (EXCLUSIVE)</option>
            {Object.values(TaxComputationType).map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="effectiveFrom">
            Effective from
          </label>
          <input
            id="effectiveFrom"
            type="date"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("effectiveFrom")}
          />
          <FieldError message={fieldErrors.effectiveFrom ?? errors.effectiveFrom?.message} />
          <p className="mt-1 text-xs text-muted-foreground">Defaults to today if left blank.</p>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="effectiveTo">
            Effective to
          </label>
          <input
            id="effectiveTo"
            type="date"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("effectiveTo")}
          />
          <FieldError message={fieldErrors.effectiveTo ?? errors.effectiveTo?.message} />
          <p className="mt-1 text-xs text-muted-foreground">Leave blank for no end date.</p>
        </div>
      </div>

      {formError && <div role="alert" className="text-sm text-destructive">{formError}</div>}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : "Create tax rate"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/accounting/tax-rates")}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
