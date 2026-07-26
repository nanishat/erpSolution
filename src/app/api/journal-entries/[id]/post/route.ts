import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { postJournalEntry } from "@/modules/accounting/services/journal-entry.service";
import { journalEntryErrorResponse } from "@/modules/accounting/utils/journal-entry-error-response";

export async function POST(
  _request: NextRequest,
  ctx: RouteContext<"/api/journal-entries/[id]/post">
) {
  const { id } = await ctx.params;

  try {
    const entry = await postJournalEntry(id);
    return NextResponse.json({ data: entry });
  } catch (error) {
    return journalEntryErrorResponse(error);
  }
}
