import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  deactivatePartner,
  getPartnerById,
  updatePartner,
} from "@/modules/partners/services/partner.service";
import { partnerErrorResponse } from "@/modules/partners/utils/partner-error-response";
import { updatePartnerSchema } from "@/modules/partners/validations/partner.schema";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/partners/[id]">
) {
  const { id } = await ctx.params;

  try {
    const partner = await getPartnerById(id);
    return NextResponse.json({ data: partner });
  } catch (error) {
    return partnerErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/partners/[id]">
) {
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = updatePartnerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const partner = await updatePartner(id, parsed.data);
    return NextResponse.json({ data: partner });
  } catch (error) {
    return partnerErrorResponse(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/partners/[id]">
) {
  const { id } = await ctx.params;

  try {
    const partner = await deactivatePartner(id);
    return NextResponse.json({ data: partner });
  } catch (error) {
    return partnerErrorResponse(error);
  }
}
