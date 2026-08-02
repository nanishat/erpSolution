import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createPartner, listPartners } from "@/modules/partners/services/partner.service";
import { partnerErrorResponse } from "@/modules/partners/utils/partner-error-response";
import {
  createPartnerSchema,
  listPartnersQuerySchema,
} from "@/modules/partners/validations/partner.schema";

export async function GET(request: NextRequest) {
  const query = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = listPartnersQuerySchema.safeParse(query);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query parameters" },
      { status: 400 }
    );
  }

  const partners = await listPartners(parsed.data);
  return NextResponse.json({ data: partners });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createPartnerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const partner = await createPartner(parsed.data);
    return NextResponse.json({ data: partner }, { status: 201 });
  } catch (error) {
    return partnerErrorResponse(error);
  }
}
