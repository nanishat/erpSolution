"use client";

import { useState, useTransition } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import { createJournalEntryAction } from "@/modules/accounting/actions/journal-entry.actions";
import type { ChartOfAccountOption } from "@/modules/accounting/types/journal-entry.types";
import {
  journalEntrySchema,
  type JournalEntryInput,
} from "@/modules/accounting/validations/journal-entry.schema";
import type { BranchOption } from "@/modules/core/services/branch.service";

// zod's `coerce`/`default` make the form's *input* shape (pre-validation) differ
// from its *output* shape (post-validation, sent to the server action), so the
// form is typed with both via react-hook-form's TFieldValues/TTransformedValues.
type JournalEntryFormValues = z.input<typeof journalEntrySchema>;

const emptyLine: JournalEntryFormValues["lines"][number] = {
  accountId: "",
  debit: 0,
  credit: 0,
  memo: "",
};

export function JournalEntryForm({
  accounts,
  branches,
}: {
  accounts: ChartOfAccountOption[];
  branches: BranchOption[];
}) {
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<JournalEntryFormValues, unknown, JournalEntryInput>({
    resolver: zodResolver(journalEntrySchema),
    defaultValues: {
      date: new Date(),
      description: "",
      reference: "",
      branchId: "",
      lines: [emptyLine, emptyLine],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "lines" });

  const onSubmit = (values: JournalEntryInput) => {
    setFormError(null);
    startTransition(async () => {
      const result = await createJournalEntryAction(values);
      if (result.success) {
        reset();
      } else {
        setFormError(result.error);
      }
    });
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-lg border border-border p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="date">
            Date
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

      <div>
        <label className="text-sm font-medium" htmlFor="branchId">
          Branch
        </label>
        <select
          id="branchId"
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          defaultValue=""
          {...register("branchId")}
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
        {errors.branchId && (
          <p className="mt-1 text-xs text-destructive">{errors.branchId.message}</p>
        )}
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
        {errors.description && (
          <p className="mt-1 text-xs text-destructive">{errors.description.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Line items</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append(emptyLine)}
          >
            Add line
          </Button>
        </div>

        {fields.map((field, index) => (
          <div
            key={field.id}
            className="grid grid-cols-[2fr_1fr_1fr_2fr_auto] items-start gap-2"
          >
            <select
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              defaultValue=""
              {...register(`lines.${index}.accountId` as const)}
            >
              <option value="" disabled>
                Select account
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} — {account.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.01"
              placeholder="Debit"
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              {...register(`lines.${index}.debit` as const, { valueAsNumber: true })}
            />
            <input
              type="number"
              step="0.01"
              placeholder="Credit"
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              {...register(`lines.${index}.credit` as const, { valueAsNumber: true })}
            />
            <input
              type="text"
              placeholder="Memo"
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              {...register(`lines.${index}.memo` as const)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={fields.length <= 2}
              onClick={() => remove(index)}
            >
              Remove
            </Button>
          </div>
        ))}

        {typeof errors.lines?.message === "string" && (
          <p className="text-xs text-destructive">{errors.lines.message}</p>
        )}
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving..." : "Create journal entry"}
      </Button>
    </form>
  );
}
