import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  createChartOfAccount,
  listChartOfAccounts,
} from "@/modules/accounting/services/chart-of-account.service";
import { chartOfAccountErrorResponse } from "@/modules/accounting/utils/chart-of-account-error-response";
import {
  createChartOfAccountSchema,
  listChartOfAccountsQuerySchema,
} from "@/modules/accounting/validations/chart-of-account.schema";

export async function GET(request: NextRequest) {
  const query = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = listChartOfAccountsQuerySchema.safeParse(query);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query parameters" },
      { status: 400 }
    );
  }

  const accounts = await listChartOfAccounts(parsed.data);
  return NextResponse.json({ data: accounts });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createChartOfAccountSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const account = await createChartOfAccount(parsed.data);
    return NextResponse.json({ data: account }, { status: 201 });
  } catch (error) {
    return chartOfAccountErrorResponse(error);
  }
}
