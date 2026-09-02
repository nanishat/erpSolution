import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createDebitVoucher } from "@/modules/accounting/services/debit-voucher.service";
import { journalEntryErrorResponse } from "@/modules/accounting/utils/journal-entry-error-response";
import { debitVoucherSchema } from "@/modules/accounting/validations/debit-voucher.schema";

// TODO: replace with the authenticated user's id once session handling (next-auth) is wired up.
const UNASSIGNED_USER_ID = "system";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = debitVoucherSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const entry = await createDebitVoucher(parsed.data, UNASSIGNED_USER_ID);
    return NextResponse.json({ data: entry }, { status: 201 });
  } catch (error) {
    return journalEntryErrorResponse(error);
  }
}
