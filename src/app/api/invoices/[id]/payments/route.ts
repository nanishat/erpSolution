import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { recordPayment } from "@/modules/payments/services/payment.service";
import { paymentErrorResponse } from "@/modules/payments/utils/payment-error-response";
import { recordPaymentSchema } from "@/modules/payments/validations/payment.schema";

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/invoices/[id]/payments">
) {
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = recordPaymentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const payment = await recordPayment(id, parsed.data);
    return NextResponse.json({ data: payment }, { status: 201 });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
