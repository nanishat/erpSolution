import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getCashFlow } from "@/modules/accounting/services/cash-flow.service";
import { reportFiltersSchema } from "@/modules/accounting/services/report-utils";

export async function GET(request: NextRequest) {
  const query = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = reportFiltersSchema.safeParse(query);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query parameters" },
      { status: 400 }
    );
  }

  try {
    const report = await getCashFlow(parsed.data);
    return NextResponse.json({ data: report });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
