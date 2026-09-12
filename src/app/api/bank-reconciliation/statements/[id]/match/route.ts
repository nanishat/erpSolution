import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { confirmMatch } from "@/modules/bank-reconciliation/services/bank-reconciliation.service";
import { bankReconciliationErrorResponse } from "@/modules/bank-reconciliation/utils/bank-reconciliation-error-response";
import { confirmMatchSchema } from "@/modules/bank-reconciliation/validations/bank-reconciliation.schema";

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/bank-reconciliation/statements/[id]/match">
) {
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = confirmMatchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const line = await confirmMatch(id, parsed.data);
    return NextResponse.json({ data: line });
  } catch (error) {
    return bankReconciliationErrorResponse(error);
  }
}
