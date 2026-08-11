// Phase 2 review follow-up: createTaxApplication (tax-application.service.ts)
// only checked that the target JournalEntry existed, not that it was DRAFT.
// The UI already guards this (Add Tax only renders for DRAFT entries), but a
// direct API call could attach a TaxApplication to an already-POSTED or VOID
// entry, and that tax would never get picked up by postJournalEntry — it
// would silently never reach the ledger. This script exercises the new
// JournalEntryNotDraftError guard added to createTaxApplication.
//
// Exercises the real HTTP API: POST /api/journal-entries,
// POST /api/journal-entries/[id]/post, POST /api/journal-entries/[id]/reverse,
// POST /api/tax-applications.
//
// Same no-cleanup convention as the other Phase 1/2 scripts: doesn't clean up
// after itself, safe to re-run, uses `TEST ... <timestamp>` naming.
import "dotenv/config";

import { db } from "../src/lib/db";

const BASE_URL = process.env.DEV_SERVER_URL ?? "http://localhost:3000";

let pass = 0;
let fail = 0;

function check(label: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`PASS - ${label}: ${detail}`);
    pass++;
  } else {
    console.log(`FAIL - ${label}: ${detail}`);
    fail++;
  }
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

type Account = { id: string; code: string };

async function createDraftEntry(
  branchId: string,
  cashAccountId: string,
  salesAccountId: string,
  description: string
) {
  const { res, json } = await api("/api/journal-entries", {
    method: "POST",
    body: JSON.stringify({
      date: new Date().toISOString(),
      description,
      branchId,
      voucherType: "CASH_VOUCHER",
      lines: [
        { accountId: cashAccountId, branchId, debit: 1000, credit: 0 },
        { accountId: salesAccountId, branchId, debit: 0, credit: 1000 },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`createDraftEntry failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json.data as { id: string; documentNumber: string; status: string };
}

async function main() {
  console.log(`Testing against ${BASE_URL}\n`);
  const stamp = Date.now();

  // --- Fixtures ---
  const { json: branchesJson } = await api("/api/branches");
  const branch = branchesJson.data[0] as { id: string };

  const { json: accountsJson } = await api("/api/accounts");
  const accounts: Account[] = accountsJson.data;
  const cash = accounts.find((a) => a.code === "1010")!;
  const salesRevenue = accounts.find((a) => a.code === "4010")!;

  // --- 1. Reject: target entry is POSTED ---
  console.log("--- Create rejected: target journal entry is POSTED ---");
  const entryPosted = await createDraftEntry(
    branch.id,
    cash.id,
    salesRevenue.id,
    `TEST draft-guard posted ${stamp}`
  );
  const { res: postRes, json: postJson } = await api(
    `/api/journal-entries/${entryPosted.id}/post`,
    { method: "POST" }
  );
  check("Fixture entry posts successfully", postRes.ok, `status=${postRes.status}`);
  check(
    "Fixture entry status is POSTED",
    postJson.data?.status === "POSTED",
    `status=${postJson.data?.status}`
  );

  const { res: taxOnPostedRes, json: taxOnPostedJson } = await api("/api/tax-applications", {
    method: "POST",
    body: JSON.stringify({
      journalEntryId: entryPosted.id,
      taxType: "VDS",
      ratePercent: 5,
      baseAmount: 1000,
    }),
  });
  check(
    "Creating a TaxApplication against a POSTED entry is rejected with 409",
    taxOnPostedRes.status === 409,
    `status=${taxOnPostedRes.status} body=${JSON.stringify(taxOnPostedJson)}`
  );
  check(
    "Rejection message names POSTED as the actual status",
    typeof taxOnPostedJson.error === "string" &&
      taxOnPostedJson.error.includes("POSTED") &&
      taxOnPostedJson.error.includes("DRAFT"),
    `error=${taxOnPostedJson.error}`
  );

  const taxCountAfterPostedAttempt = await db.taxApplication.count({
    where: { journalEntryId: entryPosted.id },
  });
  check(
    "No TaxApplication row was created against the POSTED entry",
    taxCountAfterPostedAttempt === 0,
    `count=${taxCountAfterPostedAttempt}`
  );

  // --- 2. Reject: target entry is VOID (posted then reversed) ---
  console.log("\n--- Create rejected: target journal entry is VOID ---");
  const { res: reverseRes, json: reverseJson } = await api(
    `/api/journal-entries/${entryPosted.id}/reverse`,
    { method: "POST", body: JSON.stringify({ reason: "TEST: draft-guard void fixture" }) }
  );
  check("Fixture entry reverses successfully", reverseRes.ok, `status=${reverseRes.status}`);
  check(
    "Original entry is now VOID",
    reverseJson.data?.original?.status === "VOID",
    `status=${reverseJson.data?.original?.status}`
  );

  const { res: taxOnVoidRes, json: taxOnVoidJson } = await api("/api/tax-applications", {
    method: "POST",
    body: JSON.stringify({
      journalEntryId: entryPosted.id,
      taxType: "VDS",
      ratePercent: 5,
      baseAmount: 1000,
    }),
  });
  check(
    "Creating a TaxApplication against a VOID entry is rejected with 409",
    taxOnVoidRes.status === 409,
    `status=${taxOnVoidRes.status} body=${JSON.stringify(taxOnVoidJson)}`
  );
  check(
    "Rejection message names VOID as the actual status",
    typeof taxOnVoidJson.error === "string" &&
      taxOnVoidJson.error.includes("VOID") &&
      taxOnVoidJson.error.includes("DRAFT"),
    `error=${taxOnVoidJson.error}`
  );

  const taxCountAfterVoidAttempt = await db.taxApplication.count({
    where: { journalEntryId: entryPosted.id },
  });
  check(
    "Still no TaxApplication row was created against the now-VOID entry",
    taxCountAfterVoidAttempt === 0,
    `count=${taxCountAfterVoidAttempt}`
  );

  // --- 3. Regression: a DRAFT entry still works exactly as before ---
  console.log("\n--- Regression: DRAFT entry still accepts a TaxApplication ---");
  const entryDraft = await createDraftEntry(
    branch.id,
    cash.id,
    salesRevenue.id,
    `TEST draft-guard draft-ok ${stamp}`
  );
  const { res: taxOnDraftRes, json: taxOnDraftJson } = await api("/api/tax-applications", {
    method: "POST",
    body: JSON.stringify({
      journalEntryId: entryDraft.id,
      taxType: "VDS",
      ratePercent: 5,
      baseAmount: 1000,
    }),
  });
  check(
    "Creating a TaxApplication against a DRAFT entry still succeeds",
    taxOnDraftRes.status === 201,
    `status=${taxOnDraftRes.status} body=${JSON.stringify(taxOnDraftJson)}`
  );
  check(
    "Created TaxApplication starts PENDING_REVIEW",
    taxOnDraftJson.data?.status === "PENDING_REVIEW",
    `status=${taxOnDraftJson.data?.status}`
  );
  check(
    "Created TaxApplication points at the draft entry",
    taxOnDraftJson.data?.journalEntryId === entryDraft.id,
    `journalEntryId=${taxOnDraftJson.data?.journalEntryId}`
  );

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
