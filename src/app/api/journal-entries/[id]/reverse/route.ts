import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { reverseJournalEntry } from "@/modules/accounting/services/journal-entry.service";
import { journalEntryErrorResponse } from "@/modules/accounting/utils/journal-entry-error-response";
import { reverseJournalEntrySchema } from "@/modules/accounting/validations/journal-entry.schema";

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/journal-entries/[id]/reverse">
) {
  const { id } = await ctx.params;

  // reason is optional, so an empty body is valid — don't require callers to
  // send `{}` just to satisfy request.json().
  const rawBody = await request.text();
  const parsed = reverseJournalEntrySchema.safeParse(rawBody ? JSON.parse(rawBody) : {});

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const { original, reversal } = await reverseJournalEntry(id, parsed.data.reason);
    return NextResponse.json({ data: { original, reversal } });
  } catch (error) {
    return journalEntryErrorResponse(error);
  }
}
