import { notFound } from "next/navigation";

import { getInvoiceById } from "@/modules/invoicing/services/invoice.service";
import {
  DEFAULT_INVOICE_PRINT_TEMPLATE,
  SECTOR_INVOICE_PRINT_TEMPLATES,
} from "@/modules/invoicing/print-templates/registry";

export const dynamic = "force-dynamic";

// Deliberately outside the (dashboard) route group — route groups don't
// affect the URL, so this still serves /accounting/invoices/[id]/print, but
// skips DashboardShell (sidebar/header) entirely, giving a clean,
// minimal-chrome layout suitable for browser print-to-PDF.
export default async function InvoicePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoice = await getInvoiceById(id);

  if (!invoice) {
    notFound();
  }

  const Template = invoice.sector
    ? (SECTOR_INVOICE_PRINT_TEMPLATES[invoice.sector] ?? DEFAULT_INVOICE_PRINT_TEMPLATE)
    : DEFAULT_INVOICE_PRINT_TEMPLATE;

  return <Template invoice={invoice} />;
}
