import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { recordPaymentForInvoice } from "@/modules/payments/services/payment.service";
import { paymentErrorResponse } from "@/modules/payments/utils/payment-error-response";
import { recordPaymentForInvoiceSchema } from "@/modules/payments/validations/payment.schema";

// Legacy single-invoice shape — see recordPaymentForInvoice's doc comment
// (payment.service.ts) for why this stays a thin adapter over the general
// recordPayment rather than being folded into POST /api/payments: this
// route/RecordPaymentForm.tsx only know an invoiceId, not a partnerId or an
// allocations array.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/invoices/[id]/payments">
) {
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = recordPaymentForInvoiceSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const payment = await recordPaymentForInvoice(id, parsed.data);
    return NextResponse.json({ data: payment }, { status: 201 });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
