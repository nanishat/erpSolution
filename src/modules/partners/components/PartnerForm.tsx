"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import type { Partner, PartnerType } from "@prisma/client";

import { Button } from "@/components/ui/button";
import type { BranchOption } from "@/modules/core/services/branch.service";
import {
  createPartnerSchema,
  updatePartnerSchema,
} from "@/modules/partners/validations/partner.schema";

type PartnerFormValues = {
  type: PartnerType | "";
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  tin: string;
  bin: string;
  bankName: string;
  bankAccountNumber: string;
  bankBranch: string;
  routingNumber: string;
  creditTermsDays: string;
  vatInclusiveInPrice: "" | "true" | "false";
  tdsExempt: boolean;
  tdsExemptionCertNumber: string;
  tdsExemptionExpiryDate: string;
  localBranchId: string;
  isActive: boolean;
};

function toDateInputValue(date: Date | null | undefined): string {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

function toTriState(value: boolean | null | undefined): "" | "true" | "false" {
  if (value === null || value === undefined) return "";
  return value ? "true" : "false";
}

export function PartnerForm({
  mode,
  partner,
  branches,
}: {
  mode: "create" | "edit";
  partner?: Partner;
  branches: BranchOption[];
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors },
  } = useForm<PartnerFormValues>({
    defaultValues: {
      type: partner?.type ?? "",
      name: partner?.name ?? "",
      contactPerson: partner?.contactPerson ?? "",
      phone: partner?.phone ?? "",
      email: partner?.email ?? "",
      address: partner?.address ?? "",
      tin: partner?.tin ?? "",
      bin: partner?.bin ?? "",
      bankName: partner?.bankName ?? "",
      bankAccountNumber: partner?.bankAccountNumber ?? "",
      bankBranch: partner?.bankBranch ?? "",
      routingNumber: partner?.routingNumber ?? "",
      creditTermsDays: partner?.creditTermsDays?.toString() ?? "",
      vatInclusiveInPrice: toTriState(partner?.vatInclusiveInPrice),
      tdsExempt: partner?.tdsExempt ?? false,
      tdsExemptionCertNumber: partner?.tdsExemptionCertNumber ?? "",
      tdsExemptionExpiryDate: toDateInputValue(partner?.tdsExemptionExpiryDate),
      localBranchId: partner?.localBranchId ?? "",
      isActive: partner?.isActive ?? true,
    },
  });

  const tdsExempt = watch("tdsExempt");

  const onSubmit = async (values: PartnerFormValues) => {
    setFormError(null);

    const isCreate = mode === "create";
    // create sends `undefined` to omit an optional field entirely; edit sends
    // `null` to explicitly clear it — matching the nullable().optional() shape
    // of updatePartnerSchema vs the plain .optional() shape of createPartnerSchema.
    const nullish = isCreate ? undefined : null;

    const payload: Record<string, unknown> = {
      name: values.name,
      contactPerson: values.contactPerson || nullish,
      phone: values.phone || nullish,
      email: values.email || nullish,
      address: values.address || nullish,
      tin: values.tin,
      bin: values.bin,
      bankName: values.bankName || nullish,
      bankAccountNumber: values.bankAccountNumber || nullish,
      bankBranch: values.bankBranch || nullish,
      routingNumber: values.routingNumber || nullish,
      creditTermsDays: values.creditTermsDays || nullish,
      vatInclusiveInPrice:
        values.vatInclusiveInPrice === "" ? nullish : values.vatInclusiveInPrice === "true",
      tdsExempt: values.tdsExempt,
      tdsExemptionCertNumber: values.tdsExempt
        ? values.tdsExemptionCertNumber || nullish
        : nullish,
      tdsExemptionExpiryDate: values.tdsExempt
        ? values.tdsExemptionExpiryDate || nullish
        : nullish,
      localBranchId: values.localBranchId || nullish,
    };

    if (isCreate) {
      payload.type = values.type;
    } else {
      payload.isActive = values.isActive;
    }

    const schema = isCreate ? createPartnerSchema : updatePartnerSchema;
    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && field in values) {
          setError(field as keyof PartnerFormValues, { message: issue.message });
        }
      }
      setFormError(parsed.error.issues[0]?.message ?? "Please fix the errors below.");
      return;
    }

    setIsPending(true);
    try {
      const res = await fetch(
        isCreate ? "/api/partners" : `/api/partners/${partner!.id}`,
        {
          method: isCreate ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        }
      );
      const json = await res.json();

      if (!res.ok) {
        setFormError(json.error ?? "Failed to save partner.");
        return;
      }

      router.push("/accounting/partners");
      router.refresh();
    } catch {
      setFormError("Failed to save partner.");
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
          <label className="text-sm font-medium" htmlFor="type">
            Type
          </label>
          <select
            id="type"
            disabled={mode === "edit"}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:bg-muted disabled:text-muted-foreground"
            {...register("type")}
          >
            <option value="" disabled>
              Select type
            </option>
            <option value="CUSTOMER">CUSTOMER</option>
            <option value="VENDOR">VENDOR</option>
          </select>
          {mode === "edit" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Type can&apos;t be changed after creation.
            </p>
          )}
          {errors.type && (
            <p className="mt-1 text-xs text-destructive">{errors.type.message}</p>
          )}
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
          {errors.name && (
            <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="contactPerson">
            Contact person
          </label>
          <input
            id="contactPerson"
            type="text"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("contactPerson")}
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="phone">
            Phone
          </label>
          <input
            id="phone"
            type="text"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("phone")}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="text"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("email")}
          />
          {errors.email && (
            <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="address">
            Address
          </label>
          <input
            id="address"
            type="text"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("address")}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="tin">
            TIN
          </label>
          <input
            id="tin"
            type="text"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("tin")}
          />
          {errors.tin && (
            <p className="mt-1 text-xs text-destructive">{errors.tin.message}</p>
          )}
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="bin">
            BIN
          </label>
          <input
            id="bin"
            type="text"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("bin")}
          />
          {errors.bin && (
            <p className="mt-1 text-xs text-destructive">{errors.bin.message}</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="bankName">
            Bank name
          </label>
          <input
            id="bankName"
            type="text"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("bankName")}
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="bankAccountNumber">
            Bank account number
          </label>
          <input
            id="bankAccountNumber"
            type="text"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("bankAccountNumber")}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="bankBranch">
            Bank branch
          </label>
          <input
            id="bankBranch"
            type="text"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("bankBranch")}
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="routingNumber">
            Routing number
          </label>
          <input
            id="routingNumber"
            type="text"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("routingNumber")}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="creditTermsDays">
            Credit terms (days)
          </label>
          <input
            id="creditTermsDays"
            type="number"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("creditTermsDays")}
          />
          {errors.creditTermsDays && (
            <p className="mt-1 text-xs text-destructive">{errors.creditTermsDays.message}</p>
          )}
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="vatInclusiveInPrice">
            VAT-inclusive pricing
          </label>
          <select
            id="vatInclusiveInPrice"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("vatInclusiveInPrice")}
          >
            <option value="">Not set</option>
            <option value="true">Yes — quoted price includes VAT</option>
            <option value="false">No — VAT added separately</option>
          </select>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="localBranchId">
          Local branch
        </label>
        <select
          id="localBranchId"
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          {...register("localBranchId")}
        >
          <option value="">Company-wide (no local branch)</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
        {errors.localBranchId && (
          <p className="mt-1 text-xs text-destructive">{errors.localBranchId.message}</p>
        )}
      </div>

      <div className="space-y-3 rounded-md border border-border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" {...register("tdsExempt")} />
          TDS exempt
        </label>

        {tdsExempt && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium" htmlFor="tdsExemptionCertNumber">
                Exemption certificate number
              </label>
              <input
                id="tdsExemptionCertNumber"
                type="text"
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                {...register("tdsExemptionCertNumber")}
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="tdsExemptionExpiryDate">
                Exemption expiry date
              </label>
              <input
                id="tdsExemptionExpiryDate"
                type="date"
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                {...register("tdsExemptionExpiryDate")}
              />
              {errors.tdsExemptionExpiryDate && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.tdsExemptionExpiryDate.message}
                </p>
              )}
            </div>
          </div>
        )}
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
          {isPending ? "Saving..." : mode === "create" ? "Create partner" : "Save changes"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/accounting/partners")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
