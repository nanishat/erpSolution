import { DefaultInvoicePrintTemplate } from "@/modules/invoicing/print-templates/DefaultInvoicePrintTemplate";
import type { InvoicePrintTemplate } from "@/modules/invoicing/print-templates/types";

export type { InvoicePrintTemplate, InvoicePrintTemplateProps } from "@/modules/invoicing/print-templates/types";

// Keyed by Invoice.sector (e.g. "GS" -> Guard Service, "CC" -> Cash
// Carrying) so each sector can eventually get its own layout — a per-guard
// breakdown for Guard Service, a run-sheet-style layout for Cash Carrying,
// etc. — per the business requirement for a flexible, extensible
// multi-template system rather than one fixed layout. Only the fallback
// exists today; adding a real sector template later is one more entry here,
// not a restructuring of the print page or this registry.
//
// Exported as a plain object (not wrapped in a lookup function) so callers
// resolve a template via a plain member expression rather than a function
// call — react-hooks' static-components check flags any component reference
// that flows through a CallExpression before reaching a JSX tag ("Cannot
// create components during render"), even though this registry only ever
// returns stable, module-level component references. A direct
// `SECTOR_INVOICE_PRINT_TEMPLATES[sector] ?? DEFAULT_INVOICE_PRINT_TEMPLATE`
// at the call site avoids that false positive.
export const SECTOR_INVOICE_PRINT_TEMPLATES: Record<string, InvoicePrintTemplate> = {
  // GS: GuardServicePrintTemplate,
  // CC: CashCarryingPrintTemplate,
};

// Fallback used for any sector without a dedicated template — including
// null, which covers every Vendor Bill (sector is always null for
// direction: VENDOR) and any Customer Invoice sector that hasn't gotten a
// bespoke layout yet.
export const DEFAULT_INVOICE_PRINT_TEMPLATE: InvoicePrintTemplate = DefaultInvoicePrintTemplate;
