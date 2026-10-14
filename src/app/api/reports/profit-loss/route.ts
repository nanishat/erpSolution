import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getProfitAndLoss, ProfitAndLossBranchNotFoundError } from "@/modules/accounting/services/profit-and-loss.service";
import { profitAndLossQuerySchema } from "@/modules/accounting/services/report-utils";

export async function GET(request: NextRequest) {
  const query = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = profitAndLossQuerySchema.safeParse(query);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query parameters" },
      { status: 400 }
    );
  }

  try {
    const report = await getProfitAndLoss(parsed.data);
    return NextResponse.json({ data: report });
  } catch (error) {
    if (error instanceof ProfitAndLossBranchNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
