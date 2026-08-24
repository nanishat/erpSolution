"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { TaxComputationType, TaxDirection, TaxType } from "@prisma/client";

import { Button } from "@/components/ui/button";
import type { Partner } from "@/modules/partners/services/partner.service";
import type { TaxRate } from "@/modules/tax/services/tax-rate.service";
import { createTaxApplicationSchema } from "@/modules/tax/validations/tax-application.schema";

type AddTaxApplicationFormValues = {
  taxType: TaxType | "";
  partnerId: string;
  baseAmount: string;
  direction: TaxDirection | "";
  sourceTaxRateId: string;
  ratePercent: string;
  computationType: TaxComputationType | "";
};

const emptyValues: AddTaxApplicationFormValues = {
  taxType: "",
  partnerId: "",
  baseAmount: "",
  direction: "",
  sourceTaxRateId: "",
  ratePercent: "",
  computationType: "",
};

/**
 * Attaches a new TaxApplication to a DRAFT journal entry — the missing
 * connective tissue between voucher creation and the tax engine (Phase 2
 * previously had no UI path here at all, only POST /api/tax-applications
 * called directly by tests). Its lines post automatically with the rest of
 * the entry once posted; a mistakenly-added one can be removed with
 * RemoveTaxApplicationButton while the entry is still DRAFT.
 */
export function AddTaxApplicationForm({
  journalEntryId,
  partners,
  vatRates,
}: {
  journalEntryId: string;
  partners: Partner[];
  vatRates: TaxRate[];
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors },
  } = useForm<AddTaxApplicationFormValues>({ defaultValues: emptyValues });

  const taxType = watch("taxType");
  const direction = watch("direction");
  const ratesForDirection = vatRates.filter((rate) => rate.direction === direction);

  const closeForm = () => {
    setIsOpen(false);
    setFormError(null);
    reset(emptyValues);
  };

  const onSubmit = async (values: AddTaxApplicationFormValues) => {
    setFormError(null);

    const common = {
      journalEntryId,
      partnerId: values.partnerId || undefined,
      baseAmount: values.baseAmount,
    };

    const payload =
      values.taxType === "VAT"
        ? {
            ...common,
            taxType: "VAT" as const,
            direction: values.direction,
            sourceTaxRateId: values.sourceTaxRateId,
          }
        : {
            ...common,
            taxType: values.taxType,
            ratePercent: values.ratePercent,
            computationType: values.computationType || undefined,
          };

    const parsed = createTaxApplicationSchema.safeParse(payload);

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && field in emptyValues) {
          setError(field as keyof AddTaxApplicationFormValues, { message: issue.message });
        }
      }
      setFormError(parsed.error.issues[0]?.message ?? "Please fix the errors below.");
      return;
    }

    setIsPending(true);
    try {
      const res = await fetch("/api/tax-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const json = await res.json();

      if (!res.ok) {
        setFormError(json.error ?? "Failed to add tax.");
        return;
      }

      closeForm();
      router.refresh();
    } catch {
      setFormError("Failed to add tax.");
    } finally {
      setIsPending(false);
    }
  };

  if (!isOpen) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setIsOpen(true)}>
        Add tax
      </Button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-lg border border-border p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="taxType">
            Tax type
          </label>
          <select
            id="taxType"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("taxType")}
          >
            <option value="" disabled>
              Select tax type
            </option>
            {Object.values(TaxType).map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          {errors.taxType && (
            <p className="mt-1 text-xs text-destructive">{errors.taxType.message}</p>
          )}
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="partnerId">
            Partner
          </label>
          <select
            id="partnerId"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("partnerId")}
          >
            <option value="">None</option>
            {partners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="baseAmount">
          Base amount
        </label>
        <input
          id="baseAmount"
          type="number"
          step="0.01"
          min={0}
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          {...register("baseAmount")}
        />
        {errors.baseAmount && (
          <p className="mt-1 text-xs text-destructive">{errors.baseAmount.message}</p>
        )}
      </div>

      {taxType === "VAT" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium" htmlFor="direction">
              Direction
            </label>
            <select
              id="direction"
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              {...register("direction")}
            >
              <option value="" disabled>
                Select direction
              </option>
              {Object.values(TaxDirection).map((dir) => (
                <option key={dir} value={dir}>
                  {dir}
                </option>
              ))}
            </select>
            {errors.direction && (
              <p className="mt-1 text-xs text-destructive">{errors.direction.message}</p>
            )}
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="sourceTaxRateId">
              VAT rate
            </label>
            <select
              id="sourceTaxRateId"
              disabled={!direction}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:bg-muted disabled:text-muted-foreground"
              {...register("sourceTaxRateId")}
            >
              <option value="" disabled>
                {direction ? "Select rate" : "Select a direction first"}
              </option>
              {ratesForDirection.map((rate) => (
                <option key={rate.id} value={rate.id}>
                  {rate.name} — {rate.ratePercent.toFixed(2)}%
                </option>
              ))}
            </select>
            {errors.sourceTaxRateId && (
              <p className="mt-1 text-xs text-destructive">{errors.sourceTaxRateId.message}</p>
            )}
          </div>
        </div>
      )}

      {(taxType === "TDS" || taxType === "VDS") && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium" htmlFor="ratePercent">
              Rate % (0–15, fractional allowed)
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
            {errors.ratePercent && (
              <p className="mt-1 text-xs text-destructive">{errors.ratePercent.message}</p>
            )}
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
      )}

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending || !taxType}>
          {isPending ? "Saving..." : "Add tax"}
        </Button>
        <Button type="button" variant="outline" onClick={closeForm}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
