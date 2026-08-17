import type { ComponentType } from "react";

import type { InvoiceWithLines } from "@/modules/invoicing/services/invoice.service";

export type InvoicePrintTemplateProps = { invoice: InvoiceWithLines };

export type InvoicePrintTemplate = ComponentType<InvoicePrintTemplateProps>;
