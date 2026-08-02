import { NextResponse } from "next/server";

import {
  PartnerLocalBranchNotFoundError,
  PartnerNotFoundError,
  PartnerTypeImmutableError,
} from "@/modules/partners/services/partner.service";

export function partnerErrorResponse(error: unknown): NextResponse {
  if (error instanceof PartnerNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof PartnerLocalBranchNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof PartnerTypeImmutableError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  console.error(error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
