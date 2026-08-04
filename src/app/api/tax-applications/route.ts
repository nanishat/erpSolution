import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createTaxApplication } from "@/modules/tax/services/tax-application.service";
import { taxApplicationErrorResponse } from "@/modules/tax/utils/tax-application-error-response";
import { createTaxApplicationSchema } from "@/modules/tax/validations/tax-application.schema";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createTaxApplicationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const taxApplication = await createTaxApplication(parsed.data);
    return NextResponse.json({ data: taxApplication }, { status: 201 });
  } catch (error) {
    return taxApplicationErrorResponse(error);
  }
}
