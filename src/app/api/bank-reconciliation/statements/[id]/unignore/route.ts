import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { unignoreLine } from "@/modules/bank-reconciliation/services/bank-reconciliation.service";
import { bankReconciliationErrorResponse } from "@/modules/bank-reconciliation/utils/bank-reconciliation-error-response";
import { unignoreLineSchema } from "@/modules/bank-reconciliation/validations/bank-reconciliation.schema";

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/bank-reconciliation/statements/[id]/unignore">
) {
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = unignoreLineSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const line = await unignoreLine(id, parsed.data);
    return NextResponse.json({ data: line });
  } catch (error) {
    return bankReconciliationErrorResponse(error);
  }
}
