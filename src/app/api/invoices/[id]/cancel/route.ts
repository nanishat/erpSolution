import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { cancelInvoice } from "@/modules/invoicing/services/invoice.service";
import { invoiceErrorResponse } from "@/modules/invoicing/utils/invoice-error-response";

export async function POST(
  _request: NextRequest,
  ctx: RouteContext<"/api/invoices/[id]/cancel">
) {
  const { id } = await ctx.params;

  try {
    const { invoice, journalEntry } = await cancelInvoice(id);
    return NextResponse.json({ data: { invoice, journalEntry } });
  } catch (error) {
    return invoiceErrorResponse(error);
  }
}
