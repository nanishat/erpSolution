import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getCashFlow } from "@/modules/accounting/services/cash-flow.service";
import { reportFiltersSchema } from "@/modules/accounting/services/report-utils";
import { mapCashFlow } from "@/modules/accounting/export/report-mappers";
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

  const parsed = reportFiltersSchema.safeParse(query);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query parameters" },
      { status: 400 }
    );
  }

  try {
    const report = await getCashFlow(parsed.data);
    if (format?.success) {
      const now = new Date();
      const effectiveTo =
        parsed.data.to ??
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      return await reportExportResponse(
        mapCashFlow(report, parsed.data, effectiveTo),
        format.data,
        reportExportFilename("cash-flow", {
          from: parsed.data.from,
          to: effectiveTo,
        })
      );
    }
    return NextResponse.json({ data: report });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
