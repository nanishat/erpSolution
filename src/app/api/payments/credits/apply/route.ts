import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { applyPartnerCredit } from "@/modules/payments/services/payment.service";
import { paymentErrorResponse } from "@/modules/payments/utils/payment-error-response";
import { applyPartnerCreditSchema } from "@/modules/payments/validations/payment.schema";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = applyPartnerCreditSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const result = await applyPartnerCredit(parsed.data);
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
