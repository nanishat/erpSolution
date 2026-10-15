import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getProfitAndLoss, ProfitAndLossBranchNotFoundError } from "@/modules/accounting/services/profit-and-loss.service";
import { profitAndLossQuerySchema } from "@/modules/accounting/services/report-utils";
import { mapProfitAndLoss } from "@/modules/accounting/export/report-mappers";
import {
  reportExportFilename,
  reportExportFormatSchema,
  reportExportResponse,
} from "@/modules/accounting/export/report-export";

export async function GET(request: NextRequest) {
  const query = Object.fromEntries(request.nextUrl.searchParams);
  const format = query.format === undefined
    ? undefined
    : reportExportFormatSchema.safeParse(query.format);
  if (format && !format.success) {
    return NextResponse.json(
      { error: format.error.issues[0]?.message ?? "Invalid export format" },
      { status: 400 }
    );
  }

  const parsed = profitAndLossQuerySchema.safeParse(query);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query parameters" },
      { status: 400 }
    );
  }

  try {
    const report = await getProfitAndLoss(parsed.data);
    if (format?.success) {
      return await reportExportResponse(
        mapProfitAndLoss(report, parsed.data),
        format.data,
        reportExportFilename("profit-loss", parsed.data)
      );
    }
    return NextResponse.json({ data: report });
  } catch (error) {
    if (error instanceof ProfitAndLossBranchNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
