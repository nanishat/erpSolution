import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  deactivateChartOfAccount,
  getChartOfAccountById,
  updateChartOfAccount,
} from "@/modules/accounting/services/chart-of-account.service";
import { chartOfAccountErrorResponse } from "@/modules/accounting/utils/chart-of-account-error-response";
import { updateChartOfAccountSchema } from "@/modules/accounting/validations/chart-of-account.schema";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/accounts/[id]">
) {
  const { id } = await ctx.params;

  try {
    const account = await getChartOfAccountById(id);
    return NextResponse.json({ data: account });
  } catch (error) {
    return chartOfAccountErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/accounts/[id]">
) {
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = updateChartOfAccountSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const account = await updateChartOfAccount(id, parsed.data);
    return NextResponse.json({ data: account });
  } catch (error) {
    return chartOfAccountErrorResponse(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/accounts/[id]">
) {
  const { id } = await ctx.params;

  try {
    const account = await deactivateChartOfAccount(id);
    return NextResponse.json({ data: account });
  } catch (error) {
    return chartOfAccountErrorResponse(error);
  }
}
