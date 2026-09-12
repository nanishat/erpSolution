import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { importBankStatement } from "@/modules/bank-reconciliation/services/bank-reconciliation.service";
import { bankReconciliationErrorResponse } from "@/modules/bank-reconciliation/utils/bank-reconciliation-error-response";
import { importBankStatementSchema } from "@/modules/bank-reconciliation/validations/bank-reconciliation.schema";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = importBankStatementSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const statement = await importBankStatement(parsed.data);
    return NextResponse.json({ data: statement }, { status: 201 });
  } catch (error) {
    return bankReconciliationErrorResponse(error);
  }
}
