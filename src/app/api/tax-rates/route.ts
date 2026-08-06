import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createTaxRate, listTaxRates } from "@/modules/tax/services/tax-rate.service";
import { taxRateErrorResponse } from "@/modules/tax/utils/tax-rate-error-response";
import {
  createTaxRateSchema,
  listTaxRatesQuerySchema,
} from "@/modules/tax/validations/tax-rate.schema";

export async function GET(request: NextRequest) {
  const query = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = listTaxRatesQuerySchema.safeParse(query);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query parameters" },
      { status: 400 }
    );
  }

  const rates = await listTaxRates(parsed.data);
  return NextResponse.json({ data: rates });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createTaxRateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const rate = await createTaxRate(parsed.data);
    return NextResponse.json({ data: rate }, { status: 201 });
  } catch (error) {
    return taxRateErrorResponse(error);
  }
}
