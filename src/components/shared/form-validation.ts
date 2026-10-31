export type ValidationIssue = {
  path: PropertyKey[];
  message: string;
};

export function clearFieldError(
  fieldErrors: Record<string, string>,
  fieldPath: string
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fieldErrors).filter(
      ([path]) => path !== fieldPath && !path.startsWith(`${fieldPath}.`) && !fieldPath.startsWith(`${path}.`)
    )
  );
}

export function mapValidationIssues(
  issues: ValidationIssue[],
  rowLabel = "Line"
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  for (const issue of issues) {
    if (issue.path.length === 0) continue;
    const path = issue.path.map(String).join(".");
    if (fieldErrors[path]) continue;

    const [root, rowIndex] = issue.path;
    const message =
      root === "lines" && typeof rowIndex === "number"
        ? `${rowLabel} ${rowIndex + 1}: ${issue.message}`
        : issue.message;
    fieldErrors[path] = message;
  }

  return fieldErrors;
}

export function focusFirstFieldError(fieldErrors: Record<string, string>) {
  const firstPath = Object.keys(fieldErrors)[0];
  if (!firstPath) return;

  const controls = Array.from(
    document.querySelectorAll<HTMLElement>("input, select, textarea, [data-field-path]")
  );
  const target = controls.find(
    (control) =>
      control.getAttribute("name") === firstPath ||
      control.dataset.fieldPath === firstPath ||
      control.getAttribute("name")?.startsWith(`${firstPath}.`) ||
      control.dataset.fieldPath?.startsWith(`${firstPath}.`)
  );

  target?.scrollIntoView({ block: "center" });
  target?.focus();
}
