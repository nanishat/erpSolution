import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getReconciliationSummary } from "@/modules/bank-reconciliation/services/bank-reconciliation.service";
import { bankReconciliationErrorResponse } from "@/modules/bank-reconciliation/utils/bank-reconciliation-error-response";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/bank-reconciliation/statements/[id]/summary">
) {
  const { id } = await ctx.params;

  try {
    const summary = await getReconciliationSummary(id);
    return NextResponse.json({ data: summary });
  } catch (error) {
    return bankReconciliationErrorResponse(error);
  }
}
