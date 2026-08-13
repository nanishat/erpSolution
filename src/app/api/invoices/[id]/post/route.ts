import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { postInvoice } from "@/modules/invoicing/services/invoice.service";
import { invoiceErrorResponse } from "@/modules/invoicing/utils/invoice-error-response";

export async function POST(
  _request: NextRequest,
  ctx: RouteContext<"/api/invoices/[id]/post">
) {
  const { id } = await ctx.params;

  try {
    const invoice = await postInvoice(id);
    return NextResponse.json({ data: invoice });
  } catch (error) {
    return invoiceErrorResponse(error);
  }
}
