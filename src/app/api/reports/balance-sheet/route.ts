import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getBalanceSheet } from "@/modules/accounting/services/balance-sheet.service";
import { balanceSheetQuerySchema } from "@/modules/accounting/services/report-utils";

export async function GET(request: NextRequest) {
  const query = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = balanceSheetQuerySchema.safeParse(query);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query parameters" },
      { status: 400 }
    );
  }

  try {
    const report = await getBalanceSheet(parsed.data);
    return NextResponse.json({ data: report });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
