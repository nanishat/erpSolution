"use client";

import { useState, type ChangeEvent } from "react";
import { clearFieldError, focusFirstFieldError, mapValidationIssues, type ValidationIssue } from "@/components/shared/form-validation";

export function useFieldErrors(rowLabel = "Line") {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const showIssues = (issues: ValidationIssue[]) => {
    const nextErrors = mapValidationIssues(issues, rowLabel);
    setFieldErrors(nextErrors);
    focusFirstFieldError(nextErrors);
  };

  const clearEditedField = (event: ChangeEvent<HTMLFormElement | HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const fieldPath =
      ("name" in target && typeof target.name === "string" && target.name) ||
      target.dataset.fieldPath;
    if (fieldPath) {
      setFieldErrors((previous) => clearFieldError(previous, fieldPath));
    }
  };

  return { fieldErrors, setFieldErrors, showIssues, clearEditedField };
}
