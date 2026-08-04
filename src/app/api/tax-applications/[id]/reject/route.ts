import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { rejectTaxApplication } from "@/modules/tax/services/tax-application.service";
import { taxApplicationErrorResponse } from "@/modules/tax/utils/tax-application-error-response";
import { rejectTaxApplicationSchema } from "@/modules/tax/validations/tax-application.schema";

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/tax-applications/[id]/reject">
) {
  const { id } = await ctx.params;

  // reason is optional, so an empty body is valid — don't require callers to
  // send `{}` just to satisfy request.json().
  const rawBody = await request.text();
  const parsed = rejectTaxApplicationSchema.safeParse(rawBody ? JSON.parse(rawBody) : {});

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const taxApplication = await rejectTaxApplication(id, parsed.data.reason);
    return NextResponse.json({ data: taxApplication });
  } catch (error) {
    return taxApplicationErrorResponse(error);
  }
}
