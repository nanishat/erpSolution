import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { chartOfAccountErrorResponse } from "@/modules/accounting/utils/chart-of-account-error-response";
import { getGeneralLedger } from "@/modules/accounting/services/general-ledger.service";
import { generalLedgerQuerySchema } from "@/modules/accounting/services/report-utils";

export async function GET(request: NextRequest) {
  const query = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = generalLedgerQuerySchema.safeParse(query);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query parameters" },
      { status: 400 }
    );
  }

  try {
    const report = await getGeneralLedger(parsed.data);
    return NextResponse.json({ data: report });
  } catch (error) {
    return chartOfAccountErrorResponse(error);
  }
}
