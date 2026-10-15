import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { chartOfAccountErrorResponse } from "@/modules/accounting/utils/chart-of-account-error-response";
import { getGeneralLedger } from "@/modules/accounting/services/general-ledger.service";
import { generalLedgerQuerySchema } from "@/modules/accounting/services/report-utils";
import { mapGeneralLedger } from "@/modules/accounting/export/report-mappers";
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

  const parsed = generalLedgerQuerySchema.safeParse(query);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query parameters" },
      { status: 400 }
    );
  }

  try {
    const report = await getGeneralLedger(parsed.data);
    if (format?.success) {
      return await reportExportResponse(
        mapGeneralLedger(report, parsed.data),
        format.data,
        reportExportFilename("general-ledger", parsed.data)
      );
    }
    return NextResponse.json({ data: report });
  } catch (error) {
    return chartOfAccountErrorResponse(error);
  }
}
