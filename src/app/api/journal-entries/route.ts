import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  createJournalEntry,
  getJournalEntries,
} from "@/modules/accounting/services/journal-entry.service";
import { journalEntryErrorResponse } from "@/modules/accounting/utils/journal-entry-error-response";
import { journalEntrySchema } from "@/modules/accounting/validations/journal-entry.schema";

// TODO: replace with the authenticated user's id once session handling (next-auth) is wired up.
const UNASSIGNED_USER_ID = "system";

export async function GET() {
  const entries = await getJournalEntries();
  return NextResponse.json({ data: entries });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = journalEntrySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const entry = await createJournalEntry(parsed.data, UNASSIGNED_USER_ID);
    return NextResponse.json({ data: entry }, { status: 201 });
  } catch (error) {
    return journalEntryErrorResponse(error);
  }
}
