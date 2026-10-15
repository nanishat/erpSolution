import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getTrialBalance } from "@/modules/accounting/services/trial-balance.service";
import { trialBalanceQuerySchema } from "@/modules/accounting/validations/trial-balance.schema";
import {
  mapTrialBalance,
} from "@/modules/accounting/export/report-mappers";
import {
  reportExportFilename,
  reportExportFormatSchema,
  reportExportResponse,
  trialBalanceExportViewSchema,
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

  const view = query.format === undefined
    ? undefined
    : trialBalanceExportViewSchema.safeParse(query.view ?? "flat");
  if (view && !view.success) {
    return NextResponse.json(
      { error: view.error.issues[0]?.message ?? "Invalid trial balance view" },
      { status: 400 }
    );
  }

  const parsed = trialBalanceQuerySchema.safeParse(query);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query parameters" },
      { status: 400 }
    );
  }

  const report = await getTrialBalance(parsed.data);
  if (format?.success) {
    return reportExportResponse(
      mapTrialBalance(
        report,
        {
          from: parsed.data.from,
          to: parsed.data.to,
          branchId: parsed.data.branchId,
        },
        view?.success ? view.data : "flat"
      ),
      format.data,
      reportExportFilename("trial-balance", {
        from: parsed.data.from,
        to: parsed.data.to,
      })
    );
  }
  return NextResponse.json({ data: report });
}
