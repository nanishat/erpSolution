"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AccountSubType, AccountType } from "@prisma/client";

import { Button } from "@/components/ui/button";
import type { ChartOfAccountWithChildren } from "@/modules/accounting/services/chart-of-account.service";
import {
  createChartOfAccountSchema,
  updateChartOfAccountSchema,
} from "@/modules/accounting/validations/chart-of-account.schema";

// Groups sub-types by their parent type purely for the dropdown UX — the enum
// itself doesn't encode this relationship.
const subTypesByType: Record<AccountType, AccountSubType[]> = {
  ASSET: [
    AccountSubType.CURRENT_ASSET,
    AccountSubType.FIXED_ASSET,
    AccountSubType.BANK,
    AccountSubType.CASH,
    AccountSubType.RECEIVABLE,
  ],
  LIABILITY: [
    AccountSubType.CURRENT_LIABILITY,
    AccountSubType.LONG_TERM_LIABILITY,
    AccountSubType.PAYABLE,
  ],
  EQUITY: [AccountSubType.EQUITY],
  REVENUE: [AccountSubType.OPERATING_REVENUE, AccountSubType.OTHER_REVENUE],
  EXPENSE: [
    AccountSubType.OPERATING_EXPENSE,
    AccountSubType.COST_OF_GOODS_SOLD,
    AccountSubType.OTHER_EXPENSE,
  ],
};

export type TopLevelAccountOption = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
};

type ChartOfAccountFormValues = {
  code: string;
  name: string;
  description: string;
  type: AccountType | "";
  subType: AccountSubType | "";
  parentId: string;
  isReconcilable: boolean;
  isActive: boolean;
};

export function ChartOfAccountForm({
  mode,
  account,
  topLevelAccounts,
}: {
  mode: "create" | "edit";
  account?: ChartOfAccountWithChildren;
  topLevelAccounts: TopLevelAccountOption[];
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isSystem = account?.isSystem ?? false;
  // A 2-level COA means an account that already has sub-accounts can't itself
  // become a sub-account — the parent field is only meaningful for leaf accounts.
  const hasChildren = (account?.children.length ?? 0) > 0;
  const parentOptions = topLevelAccounts.filter((a) => a.id !== account?.id);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ChartOfAccountFormValues>({
    // The schemas' output types use the strict AccountType/AccountSubType unions,
    // while this form uses "" as the sentinel for "nothing selected yet" — the
    // resolver still validates correctly at runtime (an empty string fails
    // z.nativeEnum), this cast just reconciles the two type shapes for TS.
    resolver: zodResolver(
      mode === "create" ? createChartOfAccountSchema : updateChartOfAccountSchema
    ) as Resolver<ChartOfAccountFormValues>,
    defaultValues: {
      code: account?.code ?? "",
      name: account?.name ?? "",
      description: account?.description ?? "",
      type: account?.type ?? "",
      subType: account?.subType ?? "",
      parentId: account?.parentId ?? "",
      isReconcilable: account?.isReconcilable ?? false,
      isActive: account?.isActive ?? true,
    },
  });

  const selectedType = watch("type");
  const selectedParentId = watch("parentId");

  // Selecting a parent determines the account's type (children must match
  // their parent's type), so lock `type` to whatever the parent is once one
  // is picked, rather than letting the two fields disagree.
  useEffect(() => {
    if (!selectedParentId) return;
    const parent = topLevelAccounts.find((a) => a.id === selectedParentId);
    if (parent) {
      setValue("type", parent.type, { shouldValidate: true });
    }
  }, [selectedParentId, topLevelAccounts, setValue]);

  const typeLockedByParent = !hasChildren && !!selectedParentId;
  const subTypeOptions = selectedType ? subTypesByType[selectedType] : [];

  const onSubmit = async (values: ChartOfAccountFormValues) => {
    setFormError(null);
    setIsPending(true);

    const payload =
      mode === "create"
        ? {
            code: values.code,
            name: values.name,
            description: values.description || undefined,
            type: values.type,
            subType: values.subType || undefined,
            parentId: values.parentId || undefined,
            isReconcilable: values.isReconcilable,
          }
        : {
            code: isSystem ? undefined : values.code,
            name: values.name,
            description: values.description || null,
            type: isSystem ? undefined : values.type,
            subType: values.subType || null,
            parentId: hasChildren ? undefined : values.parentId || null,
            isReconcilable: values.isReconcilable,
            isActive: values.isActive,
          };

    try {
      const res = await fetch(
        mode === "create" ? "/api/accounts" : `/api/accounts/${account!.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const json = await res.json();

      if (!res.ok) {
        setFormError(json.error ?? "Failed to save account.");
        return;
      }

      router.push("/accounting/chart-of-accounts");
      router.refresh();
    } catch {
      setFormError("Failed to save account.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-lg border border-border p-4"
    >
      {isSystem && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          This is a system account — code and type are locked.
        </p>
      )}
      {hasChildren && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          This account has sub-accounts, so it can&apos;t be moved under another
          account (the Chart of Accounts only allows 2 levels).
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="code">
            Code
          </label>
          <input
            id="code"
            type="text"
            readOnly={isSystem}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm read-only:bg-muted read-only:text-muted-foreground"
            {...register("code")}
          />
          {errors.code && (
            <p className="mt-1 text-xs text-destructive">{errors.code.message}</p>
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
          <label className="text-sm font-medium" htmlFor="parentId">
            Parent (Head of Expense)
          </label>
          <select
            id="parentId"
            disabled={hasChildren}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:bg-muted disabled:text-muted-foreground"
            {...register("parentId")}
          >
            <option value="">None (top-level account)</option>
            {parentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.code} — {option.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="type">
            Type
          </label>
          <select
            id="type"
            disabled={isSystem}
            className={
              "mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:bg-muted disabled:text-muted-foreground" +
              (typeLockedByParent ? " pointer-events-none opacity-60" : "")
            }
            {...register("type")}
          >
            <option value="" disabled>
              Select type
            </option>
            {Object.values(AccountType).map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          {typeLockedByParent && (
            <p className="mt-1 text-xs text-muted-foreground">
              Locked to the parent account&apos;s type.
            </p>
          )}
          {errors.type && (
            <p className="mt-1 text-xs text-destructive">{errors.type.message}</p>
          )}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="subType">
          Sub type
        </label>
        <select
          id="subType"
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          {...register("subType")}
        >
          <option value="">None</option>
          {subTypeOptions.map((subType) => (
            <option key={subType} value={subType}>
              {subType}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" {...register("isReconcilable")} />
          Reconcilable
        </label>
        {mode === "edit" && (
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" disabled={isSystem} {...register("isActive")} />
            Active
          </label>
        )}
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : mode === "create" ? "Create account" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/accounting/chart-of-accounts")}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
