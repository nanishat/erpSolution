import { NextResponse } from "next/server";

import { TaxRateNotFoundError } from "@/modules/tax/services/tax-rate.service";

export function taxRateErrorResponse(error: unknown): NextResponse {
  if (error instanceof TaxRateNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  console.error(error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
