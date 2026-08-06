// Tax Approval Queue UI manual test — the list page at
// /accounting/tax-applications built on top of the approve/reject API
// already covered end-to-end by phase2-tax-application-manual-test.ts. No
// new backend logic here; this only exercises the page (TaxApplicationTable)
// and confirms it reflects real approve/reject state changes.
//
// There's no headless-browser/JSDOM runner wired up (see tests/README.md),
// so this fetches the server-rendered HTML and asserts on markup — same
// convention as phase2-partner-ui-manual-test.ts. The page's status filter
// is a client-side React state default (initial value "PENDING_REVIEW"),
// which React still applies during SSR, so the *initial* HTML response is
// already filtered to PENDING_REVIEW rows — that's what lets this script
// assert "disappears from the default filtered view" from a plain fetch.
//
// Same conventions as the other Phase 1/2 scripts: doesn't clean up after
// itself, safe to re-run, uses `TEST ... <timestamp>` naming.
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

async function page(path: string) {
  const res = await fetch(`${BASE_URL}${path}`);
  const html = await res.text();
  return { res, html };
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
  return json.data as { id: string; documentNumber: string };
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

  // VDS with a manually-entered ratePercent needs no TaxRate fixture, same
  // as the "gate"/reject cases in phase2-tax-application-manual-test.ts.
  const entryToApprove = await createDraftEntry(
    branch.id,
    cash.id,
    salesRevenue.id,
    `TEST tax-queue-approve ${stamp}`
  );
  const { json: approveTaxJson } = await api("/api/tax-applications", {
    method: "POST",
    body: JSON.stringify({
      journalEntryId: entryToApprove.id,
      taxType: "VDS",
      ratePercent: 5,
      baseAmount: 1000,
    }),
  });
  const taxApplicationToApprove = approveTaxJson.data as { id: string };

  const entryToReject = await createDraftEntry(
    branch.id,
    cash.id,
    salesRevenue.id,
    `TEST tax-queue-reject ${stamp}`
  );
  const { json: rejectTaxJson } = await api("/api/tax-applications", {
    method: "POST",
    body: JSON.stringify({
      journalEntryId: entryToReject.id,
      taxType: "VDS",
      ratePercent: 5,
      baseAmount: 1000,
    }),
  });
  const taxApplicationToReject = rejectTaxJson.data as { id: string };

  // --- 1. Page renders, both pending applications show up ---
  console.log("--- Page renders with both pending applications ---");
  const { res: listRes, html: listHtmlBefore } = await page("/accounting/tax-applications");
  check("GET /accounting/tax-applications succeeds", listRes.ok, `status=${listRes.status}`);
  check(
    "Page has the Tax approval queue heading",
    listHtmlBefore.includes("Tax approval queue"),
    "heading present"
  );
  check(
    "Page has an ALL status filter option",
    listHtmlBefore.includes('value="ALL"'),
    "option present"
  );
  check(
    "Approve-target entry's document number appears (PENDING_REVIEW, default filter)",
    listHtmlBefore.includes(entryToApprove.documentNumber),
    `looked for "${entryToApprove.documentNumber}"`
  );
  check(
    "Reject-target entry's document number appears (PENDING_REVIEW, default filter)",
    listHtmlBefore.includes(entryToReject.documentNumber),
    `looked for "${entryToReject.documentNumber}"`
  );

  // --- 2. Approve flow: pending -> approved, disappears from default filtered view ---
  console.log("\n--- Approve flow ---");
  const { res: approveRes, json: approveJson } = await api(
    `/api/tax-applications/${taxApplicationToApprove.id}/approve`,
    { method: "POST" }
  );
  check("Approve succeeds", approveRes.ok, `status=${approveRes.status}`);
  check(
    "TaxApplication status is now APPROVED",
    approveJson.data?.status === "APPROVED",
    `status=${approveJson.data?.status}`
  );

  const { html: listHtmlAfterApprove } = await page("/accounting/tax-applications");
  check(
    "Approved entry's document number no longer appears in the default (PENDING_REVIEW) view",
    !listHtmlAfterApprove.includes(entryToApprove.documentNumber),
    `looked for absence of "${entryToApprove.documentNumber}"`
  );
  check(
    "Still-pending reject-target entry's document number still appears",
    listHtmlAfterApprove.includes(entryToReject.documentNumber),
    `looked for "${entryToReject.documentNumber}"`
  );

  // --- 3. Reject flow: reason is recorded, disappears from default filtered view ---
  console.log("\n--- Reject flow ---");
  const rejectionReason = `TEST rejection reason ${stamp}`;
  const { res: rejectRes, json: rejectJson } = await api(
    `/api/tax-applications/${taxApplicationToReject.id}/reject`,
    { method: "POST", body: JSON.stringify({ reason: rejectionReason }) }
  );
  check("Reject succeeds", rejectRes.ok, `status=${rejectRes.status}`);
  check(
    "TaxApplication status is now REJECTED",
    rejectJson.data?.status === "REJECTED",
    `status=${rejectJson.data?.status}`
  );
  check(
    "rejectionReason is persisted in the API response",
    rejectJson.data?.rejectionReason === rejectionReason,
    `rejectionReason=${rejectJson.data?.rejectionReason}`
  );

  const rejectedRow = await db.taxApplication.findUniqueOrThrow({
    where: { id: taxApplicationToReject.id },
  });
  check(
    "rejectionReason is persisted in the database",
    rejectedRow.rejectionReason === rejectionReason,
    `rejectionReason=${rejectedRow.rejectionReason}`
  );

  const { html: listHtmlAfterReject } = await page("/accounting/tax-applications");
  check(
    "Rejected entry's document number no longer appears in the default (PENDING_REVIEW) view",
    !listHtmlAfterReject.includes(entryToReject.documentNumber),
    `looked for absence of "${entryToReject.documentNumber}"`
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
