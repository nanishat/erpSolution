import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { mapVatReport } from "@/modules/accounting/export/report-mappers";
import {
  reportExportFilename,
  reportExportFormatSchema,
  reportExportResponse,
} from "@/modules/accounting/export/report-export";
import { getVatReport } from "@/modules/accounting/services/vat-report.service";
import { vatReportQuerySchema } from "@/modules/accounting/services/report-utils";

export async function GET(request: NextRequest) {
  const query = Object.fromEntries(request.nextUrl.searchParams);
  const format =
    query.format === undefined ? undefined : reportExportFormatSchema.safeParse(query.format);
  if (format && !format.success) {
    return NextResponse.json(
      { error: format.error.issues[0]?.message ?? "Invalid export format" },
      { status: 400 }
    );
  }

  const parsed = vatReportQuerySchema.safeParse(query);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query parameters" },
      { status: 400 }
    );
  }

  try {
    const report = await getVatReport(parsed.data);
    if (format?.success) {
      return await reportExportResponse(
        mapVatReport(report, parsed.data),
        format.data,
        reportExportFilename("vat", parsed.data)
      );
    }
    return NextResponse.json({ data: report });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
