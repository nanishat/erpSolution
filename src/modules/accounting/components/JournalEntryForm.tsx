"use client";

import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import { AccountPicker } from "@/components/shared/AccountPicker";
import { BalanceSummary, toPaisa } from "@/components/shared/BalanceSummary";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";
import Link from "next/link";
import { createJournalEntryAction } from "@/modules/accounting/actions/journal-entry.actions";
import {
  CREDIT_VOUCHER_SECTOR_CODES,
  CREDIT_VOUCHER_SECTOR_LABELS,
} from "@/modules/accounting/constants/sector";
import {
  USER_CREATABLE_VOUCHER_TYPES,
  VOUCHER_TYPE_LABELS,
} from "@/modules/accounting/constants/voucher-type";
import type {
  ChartOfAccountOption,
  JournalEntryWithLines,
} from "@/modules/accounting/types/journal-entry.types";
import {
  journalEntrySchema,
  updateJournalEntrySchema,
  type JournalEntryInput,
} from "@/modules/accounting/validations/journal-entry.schema";
import type { BranchOption } from "@/modules/core/services/branch.service";

// zod's `coerce`/`default` make the form's *input* shape (pre-validation) differ
// from its *output* shape (post-validation, sent to the server action), so the
// form is typed with both via react-hook-form's TFieldValues/TTransformedValues.
type JournalEntryFormValues = z.input<typeof journalEntrySchema>;

const emptyLine = (branchId: string): JournalEntryFormValues["lines"][number] => ({
  accountId: "",
  branchId,
  debit: 0,
  credit: 0,
  memo: "",
});

export function JournalEntryForm({
  mode = "create",
  entry,
  accounts,
  branches,
}: {
  mode?: "create" | "edit";
  entry?: JournalEntryWithLines;
  accounts: ChartOfAccountOption[];
  branches: BranchOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    getValues,
    setValue,
    formState: { errors, isDirty },
  } = useForm<JournalEntryFormValues, unknown, JournalEntryInput>({
    // voucherType/branchId aren't part of updateJournalEntrySchema (they're
    // locked after creation), but the form still renders read-only fields for
    // them in edit mode, so the values shape stays the same either way.
    resolver: zodResolver(
      mode === "create" ? journalEntrySchema : updateJournalEntrySchema
    ) as unknown as Resolver<JournalEntryFormValues, unknown, JournalEntryInput>,
    defaultValues: entry
      ? {
          date: entry.date,
          description: entry.description,
          reference: entry.reference ?? "",
          branchId: entry.branchId,
          voucherType: entry.voucherType,
          sector:
            CREDIT_VOUCHER_SECTOR_CODES.find((code) => code === entry.sector) ?? null,
          lines: entry.lines.map((line) => ({
            accountId: line.accountId,
            branchId: line.branchId,
            debit: line.debit,
            credit: line.credit,
            memo: line.memo ?? "",
          })),
        }
      : {
          date: new Date(),
          description: "",
          reference: "",
          branchId: "",
          voucherType: undefined,
          sector: null,
          lines: [emptyLine(""), emptyLine("")],
        },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const entryBranchId = useWatch({ control, name: "branchId" });
  const voucherType = useWatch({ control, name: "voucherType" });
  const sector = useWatch({ control, name: "sector" });
  const watchedLines = useWatch({ control, name: "lines" });
  const gridRef = useRef<HTMLDivElement>(null);
  const { markSubmitted, resetSubmitted } = useUnsavedChangesWarning(isDirty);
  const debitPaisa = watchedLines.reduce((sum, line) => sum + toPaisa(Number(line.debit) || 0), 0);
  const creditPaisa = watchedLines.reduce((sum, line) => sum + toPaisa(Number(line.credit) || 0), 0);

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

    const nextRowIndex = fields.length;
    append(emptyLine(entryBranchId ?? ""));
    requestAnimationFrame(() => {
      gridRef.current
        ?.querySelector<HTMLElement>(`[data-line-row="${nextRowIndex}"] [data-line-cell]`)
        ?.focus();
    });
  };

  // Newly selecting the entry's branch defaults any not-yet-assigned line
  // branches to it, while leaving lines the user already set alone (a single
  // voucher can allocate across branches on different lines).
  useEffect(() => {
    if (!entryBranchId || mode === "edit") return;
    getValues("lines").forEach((line, index) => {
      if (!line.branchId) {
        setValue(`lines.${index}.branchId`, entryBranchId);
      }
    });
  }, [entryBranchId, mode, getValues, setValue]);

  const onSubmit = (values: JournalEntryInput) => {
    setFormError(null);

    if (mode === "edit") {
      startTransition(async () => {
        const res = await fetch(`/api/journal-entries/${entry!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        });
        const json = await res.json();

        if (!res.ok) {
          setFormError(json.error ?? "Failed to save journal entry.");
          return;
        }

        markSubmitted();
        router.push("/accounting/journal-entries");
        router.refresh();
      });
      return;
    }

    startTransition(async () => {
      const result = await createJournalEntryAction(values);
      if (result.success) {
        markSubmitted();
        reset();
        resetSubmitted();
      } else {
        setFormError(result.error);
      }
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={mode === "create" ? "New Journal Voucher" : "Edit Journal Voucher"}
        description="Record the date, branch, and balanced account entries for this voucher."
      />
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {formError && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </div>
        )}
        <Card title="Basic Details">
          <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="date">
            Date *
          </label>
          <input
            id="date"
            type="date"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("date", { valueAsDate: true })}
          />
          {errors.date && (
            <p className="mt-1 text-xs text-destructive">{errors.date.message}</p>
          )}
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="reference">
            Reference
          </label>
          <input
            id="reference"
            type="text"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            {...register("reference")}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="branchId">
            Branch *
          </label>
          <select
            id="branchId"
            disabled={mode === "edit"}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:bg-muted disabled:text-muted-foreground"
            defaultValue=""
            {...register("branchId")}
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
          {mode === "edit" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Locked — the document number is stamped from this branch.
            </p>
          )}
          {errors.branchId && (
            <p className="mt-1 text-xs text-destructive">{errors.branchId.message}</p>
          )}
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="voucherType">
            Voucher Type *
          </label>
          <select
            id="voucherType"
            disabled={mode === "edit"}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:bg-muted disabled:text-muted-foreground"
            defaultValue=""
            {...register("voucherType")}
          >
            <option value="" disabled>
              Select voucher type
            </option>
            {USER_CREATABLE_VOUCHER_TYPES.map((voucherType) => (
              <option key={voucherType} value={voucherType}>
                {VOUCHER_TYPE_LABELS[voucherType]}
              </option>
            ))}
          </select>
          {errors.voucherType && (
            <p className="mt-1 text-xs text-destructive">{errors.voucherType.message}</p>
          )}
        </div>
      </div>

      {mode === "edit" && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Document number: <span className="font-mono">{entry!.documentNumber}</span>
        </p>
      )}

      {voucherType === "CREDIT_VOUCHER" && (
        <div>
          <label className="text-sm font-medium" htmlFor="sector">
            Sector
          </label>
          <select
            id="sector"
            value={sector ?? ""}
            onChange={(event) =>
              setValue(
                "sector",
                CREDIT_VOUCHER_SECTOR_CODES.find((code) => code === event.target.value) ?? null,
                { shouldValidate: true }
              )
            }
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="">No sector</option>
            {CREDIT_VOUCHER_SECTOR_CODES.map((code) => (
              <option key={code} value={code}>
                {CREDIT_VOUCHER_SECTOR_LABELS[code]}
              </option>
            ))}
          </select>
          {errors.sector && (
            <p className="mt-1 text-xs text-destructive">{errors.sector.message}</p>
          )}
        </div>
      )}
        </Card>

        <Card title="Entries">
      <div className="space-y-3" ref={gridRef} onKeyDown={handleGridKeyDown}>
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Add each debit or credit account as a separate entry.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append(emptyLine(entryBranchId ?? ""))}
          >
            Add line
          </Button>
        </div>

        {fields.map((field, index) => (
          <div
            key={field.id}
            data-line-row={index}
            className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2 xl:grid-cols-6"
          >
            <div>
              <label className="text-sm font-medium" htmlFor={`line-${index}-account`}>Account *</label>
              {accounts.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  No accounts available. <Link className="underline" href="/accounting/chart-of-accounts">Create one</Link>.
                </p>
              ) : (
                <AccountPicker
                  id={`line-${index}-account`}
                  options={accounts}
                  value={watchedLines[index]?.accountId ?? ""}
                  onChange={(accountId) => setValue(`lines.${index}.accountId`, accountId, { shouldDirty: true })}
                />
              )}
              {errors.lines?.[index]?.accountId && <p className="mt-1 text-xs text-destructive">{errors.lines[index].accountId.message}</p>}
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor={`line-${index}-branch`}>Branch *</label>
              <select
                id={`line-${index}-branch`}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                {...register(`lines.${index}.branchId` as const)}
                data-line-cell
              >
                <option value="" disabled>Select branch</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor={`line-${index}-debit`}>Debit</label>
              <input
                id={`line-${index}-debit`}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-right text-sm tabular-nums"
                {...register(`lines.${index}.debit` as const, { valueAsNumber: true })}
                data-line-cell
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor={`line-${index}-credit`}>Credit</label>
              <input
                id={`line-${index}-credit`}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-right text-sm tabular-nums"
                {...register(`lines.${index}.credit` as const, { valueAsNumber: true })}
                data-line-cell
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor={`line-${index}-memo`}>Memo</label>
              <input
                id={`line-${index}-memo`}
                type="text"
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                {...register(`lines.${index}.memo` as const)}
                data-line-cell
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={fields.length <= 2}
                aria-label={`Remove entry ${index + 1}`}
                onClick={() => remove(index)}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}

        {typeof errors.lines?.message === "string" && (
          <p className="text-xs text-destructive">{errors.lines.message}</p>
        )}
      </div>
      <BalanceSummary debitPaisa={debitPaisa} creditPaisa={creditPaisa} />
        </Card>

        <Card title="Notes">
          <div>
            <label className="text-sm font-medium" htmlFor="description">Description *</label>
            <input
              id="description"
              type="text"
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              {...register("description")}
            />
            {errors.description && <p className="mt-1 text-xs text-destructive">{errors.description.message}</p>}
          </div>
        </Card>

        <div className="flex items-center gap-4 border-t border-border pt-4">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving..." : "Save as Draft"}
          </Button>
          <Link href="/accounting/journal-entries" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
