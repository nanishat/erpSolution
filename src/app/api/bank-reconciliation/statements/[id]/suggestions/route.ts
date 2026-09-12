import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { suggestMatches } from "@/modules/bank-reconciliation/services/bank-reconciliation.service";
import { bankReconciliationErrorResponse } from "@/modules/bank-reconciliation/utils/bank-reconciliation-error-response";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/bank-reconciliation/statements/[id]/suggestions">
) {
  const { id } = await ctx.params;

  try {
    const suggestions = await suggestMatches(id);
    return NextResponse.json({ data: suggestions });
  } catch (error) {
    return bankReconciliationErrorResponse(error);
  }
}
