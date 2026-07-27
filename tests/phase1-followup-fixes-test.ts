// Follow-up test for the three Phase 1 review fixes:
//   1. GET /api/branches
//   2. `/` redirects to `/accounting`
//   3. Reversing a reversal entry is rejected (CannotReverseAReversalError);
//      reversing an original entry still works (regression check).
//
// Same conventions as phase1-ledger-manual-test.ts: hits the real HTTP API
// against a running dev server, doesn't clean up after itself. See
// tests/README.md.
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

async function main() {
  console.log(`Testing against ${BASE_URL}\n`);

  // --- 1. GET /api/branches ---
  console.log("--- GET /api/branches ---");
  const expectedBranches = await db.branch.findMany({
    orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
    select: { id: true, name: true, code: true, isHeadOffice: true },
  });
  const { res: branchesRes, json: branchesJson } = await api("/api/branches");
  check("GET /api/branches succeeds", branchesRes.ok, `status=${branchesRes.status}`);
  check(
    "GET /api/branches returns the same branches as the DB",
    JSON.stringify(branchesJson.data) === JSON.stringify(expectedBranches),
    `got ${JSON.stringify(branchesJson.data)}`
  );

  // --- 2. `/` redirects to `/accounting` ---
  console.log("\n--- `/` redirect ---");
  const rootRes = await fetch(BASE_URL, { redirect: "manual" });
  const location = rootRes.headers.get("location");
  check(
    "`/` responds with a redirect status (3xx)",
    rootRes.status >= 300 && rootRes.status < 400,
    `status=${rootRes.status}`
  );
  check(
    "`/` redirects to /accounting",
    location === "/accounting" || location === `${BASE_URL}/accounting`,
    `location=${location}`
  );

  // --- 3. Reversal restriction ---
  console.log("\n--- Reversal restriction (reversal-of-a-reversal rejected) ---");
  const branch = await db.branch.findFirstOrThrow({ where: { isHeadOffice: true } });
  const cash = await db.chartOfAccount.findUniqueOrThrow({ where: { code: "1010" } });
  const salesRevenue = await db.chartOfAccount.findUniqueOrThrow({ where: { code: "4010" } });

  const { json: createJson } = await api("/api/journal-entries", {
    method: "POST",
    body: JSON.stringify({
      date: new Date().toISOString(),
      description: "TEST: followup-fixes reversal-restriction original",
      branchId: branch.id,
      voucherType: "CASH_VOUCHER",
      lines: [
        { accountId: cash.id, branchId: branch.id, debit: 100, credit: 0 },
        { accountId: salesRevenue.id, branchId: branch.id, debit: 0, credit: 100 },
      ],
    }),
  });
  const original = createJson.data as { id: string; documentNumber: string };
  await api(`/api/journal-entries/${original.id}/post`, { method: "POST" });
  console.log(`Created + posted original entry ${original.documentNumber}`);

  // Regression check: reversing the ORIGINAL still works.
  const { res: firstReverseRes, json: firstReverseJson } = await api(
    `/api/journal-entries/${original.id}/reverse`,
    { method: "POST", body: JSON.stringify({ reason: "TEST: followup-fixes" }) }
  );
  check(
    "Reversing an original (non-reversal) entry still succeeds (regression check)",
    firstReverseRes.ok,
    `status=${firstReverseRes.status}`
  );
  const reversal = firstReverseJson.data?.reversal as { id: string; documentNumber: string } | undefined;
  console.log(`Reversed original -> reversal entry ${reversal?.documentNumber}`);

  // Attempting to reverse the REVERSAL itself must be rejected.
  const { res: secondReverseRes, json: secondReverseJson } = await api(
    `/api/journal-entries/${reversal!.id}/reverse`,
    { method: "POST", body: JSON.stringify({ reason: "TEST: should be rejected" }) }
  );
  check(
    "Reversing a reversal entry is rejected with 409",
    secondReverseRes.status === 409,
    `status=${secondReverseRes.status} body=${JSON.stringify(secondReverseJson)}`
  );
  check(
    "Rejection error message identifies it as 'itself a reversal'",
    typeof secondReverseJson.error === "string" && secondReverseJson.error.includes("itself a reversal"),
    `error=${secondReverseJson.error}`
  );

  // The reversal entry should not have been mutated by the rejected attempt.
  const { json: reversalDetailJson } = await api(`/api/journal-entries/${reversal!.id}`);
  check(
    "Reversal entry's status is untouched by the rejected reverse attempt",
    reversalDetailJson.data.status === "POSTED",
    `status=${reversalDetailJson.data.status}`
  );

  // --- UI-level check: the reversal entry's detail page must not render a Reverse action ---
  console.log("\n--- Reverse action hidden on reversal entry's detail page ---");
  const reversalPageHtml = await (await fetch(`${BASE_URL}/accounting/journal-entries/${reversal!.id}`)).text();
  check(
    "Reversal entry's detail page has no 'Reverse' button",
    !/>Reverse<\/button>/.test(reversalPageHtml),
    reversalPageHtml.includes(">Reverse</button>") ? "found a Reverse button" : "no Reverse button present"
  );
  const originalPageHtml = await (await fetch(`${BASE_URL}/accounting/journal-entries/${original.id}`)).text();
  // The original is now VOID, so JournalEntryDetailActions renders nothing for it either —
  // this just confirms that page still renders without error post-reversal.
  check(
    "Original (now VOID) entry's detail page renders without a Reverse button either",
    !/>Reverse<\/button>/.test(originalPageHtml),
    "no Reverse button present"
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
