import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  deactivateTaxRate,
  getTaxRateById,
  updateTaxRate,
} from "@/modules/tax/services/tax-rate.service";
import { taxRateErrorResponse } from "@/modules/tax/utils/tax-rate-error-response";
import { updateTaxRateSchema } from "@/modules/tax/validations/tax-rate.schema";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/tax-rates/[id]">
) {
  const { id } = await ctx.params;

  try {
    const rate = await getTaxRateById(id);
    return NextResponse.json({ data: rate });
  } catch (error) {
    return taxRateErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/tax-rates/[id]">
) {
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = updateTaxRateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const rate = await updateTaxRate(id, parsed.data);
    return NextResponse.json({ data: rate });
  } catch (error) {
    return taxRateErrorResponse(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/tax-rates/[id]">
) {
  const { id } = await ctx.params;

  try {
    const rate = await deactivateTaxRate(id);
    return NextResponse.json({ data: rate });
  } catch (error) {
    return taxRateErrorResponse(error);
  }
}
