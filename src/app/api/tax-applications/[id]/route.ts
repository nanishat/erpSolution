import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { deleteTaxApplication } from "@/modules/tax/services/tax-application.service";
import { taxApplicationErrorResponse } from "@/modules/tax/utils/tax-application-error-response";

export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/tax-applications/[id]">
) {
  const { id } = await ctx.params;

  try {
    const taxApplication = await deleteTaxApplication(id);
    return NextResponse.json({ data: taxApplication });
  } catch (error) {
    return taxApplicationErrorResponse(error);
  }
}
