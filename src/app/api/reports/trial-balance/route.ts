import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getTrialBalance } from "@/modules/accounting/services/trial-balance.service";
import { trialBalanceQuerySchema } from "@/modules/accounting/validations/trial-balance.schema";

export async function GET(request: NextRequest) {
  const query = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = trialBalanceQuerySchema.safeParse(query);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query parameters" },
      { status: 400 }
    );
  }

  const report = await getTrialBalance(parsed.data);
  return NextResponse.json({ data: report });
}
