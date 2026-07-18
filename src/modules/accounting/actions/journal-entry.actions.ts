"use server";

import { revalidatePath } from "next/cache";

import { createJournalEntry } from "@/modules/accounting/services/journal-entry.service";
import {
  journalEntrySchema,
  type JournalEntryInput,
} from "@/modules/accounting/validations/journal-entry.schema";

// TODO: replace with the authenticated user's id once session handling (next-auth) is wired up.
const UNASSIGNED_USER_ID = "system";

export type CreateJournalEntryResult =
  | { success: true; entryId: string }
  | { success: false; error: string };

export async function createJournalEntryAction(
  input: JournalEntryInput
): Promise<CreateJournalEntryResult> {
  const parsed = journalEntrySchema.safeParse(input);

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid journal entry.",
    };
  }

  try {
    const entry = await createJournalEntry(parsed.data, UNASSIGNED_USER_ID);
    revalidatePath("/accounting");
    return { success: true, entryId: entry.id };
  } catch {
    return { success: false, error: "Failed to create journal entry." };
  }
}
