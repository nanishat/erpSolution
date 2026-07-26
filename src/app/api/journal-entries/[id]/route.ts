import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  getJournalEntryById,
  updateJournalEntry,
} from "@/modules/accounting/services/journal-entry.service";
import { journalEntryErrorResponse } from "@/modules/accounting/utils/journal-entry-error-response";
import { updateJournalEntrySchema } from "@/modules/accounting/validations/journal-entry.schema";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/journal-entries/[id]">
) {
  const { id } = await ctx.params;

  const entry = await getJournalEntryById(id);
  if (!entry) {
    return NextResponse.json({ error: `Journal entry ${id} not found` }, { status: 404 });
  }

  return NextResponse.json({ data: entry });
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/journal-entries/[id]">
) {
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = updateJournalEntrySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const entry = await updateJournalEntry(id, parsed.data);
    return NextResponse.json({ data: entry });
  } catch (error) {
    return journalEntryErrorResponse(error);
  }
}
