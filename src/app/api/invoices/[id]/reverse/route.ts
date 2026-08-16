import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { reverseInvoice } from "@/modules/invoicing/services/invoice.service";
import { invoiceErrorResponse } from "@/modules/invoicing/utils/invoice-error-response";
import { reverseInvoiceSchema } from "@/modules/invoicing/validations/invoice.schema";

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/invoices/[id]/reverse">
) {
  const { id } = await ctx.params;

  // reason is optional, so an empty body is valid — don't require callers to
  // send `{}` just to satisfy request.json() (same pattern as
  // /api/journal-entries/[id]/reverse).
  const rawBody = await request.text();
  const parsed = reverseInvoiceSchema.safeParse(rawBody ? JSON.parse(rawBody) : {});

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const { invoice, journalEntry } = await reverseInvoice(id, parsed.data.reason);
    return NextResponse.json({ data: { invoice, journalEntry } });
  } catch (error) {
    return invoiceErrorResponse(error);
  }
}
