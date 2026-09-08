import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getOpenInvoicesForPartner } from "@/modules/payments/services/payment.service";
import { paymentErrorResponse } from "@/modules/payments/utils/payment-error-response";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/partners/[id]/open-invoices">
) {
  const { id } = await ctx.params;

  try {
    const invoices = await getOpenInvoicesForPartner(id);
    return NextResponse.json({ data: invoices });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
