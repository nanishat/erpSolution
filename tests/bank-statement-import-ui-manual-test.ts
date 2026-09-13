// Bank Reconciliation import UI manual test — covers the pages built on top
// of the CSV import API (bank-statement-csv-import-manual-test.ts covers the
// API itself end to end): /accounting/bank-reconciliation (statement list)
// and /accounting/bank-reconciliation/import (the account/period/balance
// form + CSV upload + column-mapping + preview stepper).
//
// There's no headless-browser/JSDOM runner wired up (see tests/README.md),
// and the import page's stepper only advances via client-side JS (dryRun
// fetch calls to the same import-csv route), so this can't literally click
// through the stepper. Instead it (a) asserts the initial server-rendered
// markup of both pages, and (b) drives the same dryRun/columnMapping/commit
// sequence the stepper's onClick handlers make, directly against the route,
// the same "assert markup + hit the real API for behavior" split used by
// phase2-partner-ui-manual-test.ts and product-service-ui-manual-test.ts.
//
// `appearsRendered` (`>value<`) is used wherever a check needs to prove text
// is actually in the rendered DOM, not just present in the page's serialized
// RSC-hydration payload — see product-service-ui-manual-test.ts's doc
// comment for why a plain substring search isn't enough.
//
// Same conventions as the other manual scripts: doesn't clean up after
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

// Matches the actual rendered anchor/cell text (`>value<`), not the
// JSON-escaped RSC hydration payload also present in the document.
function appearsRendered(html: string, text: string): boolean {
  return html.includes(`>${text}<`);
}

// Same shape as bank-statement-csv-import-manual-test.ts's postCsv helper —
// no Content-Type header, so fetch/undici derives the multipart boundary
// from the FormData body itself.
async function postCsv(fields: Record<string, string>, csvContent: string, filename = "statement.csv") {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  form.append("file", new File([csvContent], filename, { type: "text/csv" }));
  const res = await fetch(`${BASE_URL}/api/bank-reconciliation/statements/import-csv`, {
    method: "POST",
    body: form,
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

async function main() {
  console.log(`Testing against ${BASE_URL}\n`);
  const stamp = Date.now();

  // --- Fixture: a reconcilable Bank account (the import picker only offers
  // isActive + isReconcilable accounts — getReconcilableChartOfAccounts) ---
  const accountName = `TEST BRUI Bank ${stamp}`;
  const accountCode = `TEST-BRUI-${stamp}`;
  const { res: accountRes, json: accountJson } = await api("/api/accounts", {
    method: "POST",
    body: JSON.stringify({
      code: accountCode,
      name: accountName,
      type: "ASSET",
      subType: "BANK",
      isReconcilable: true,
    }),
  });
  if (!accountRes.ok) {
    throw new Error(`Failed to create reconcilable account fixture: ${JSON.stringify(accountJson)}`);
  }
  const account = accountJson.data as { id: string; code: string; name: string };

  const periodStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const periodEnd = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const uniq = (stamp % 9000) / 100;

  // ============================================================
  // 1. Import page renders the expected fields
  // ============================================================
  console.log("--- Import page renders ---");
  const { res: importPageRes, html: importHtml } = await page("/accounting/bank-reconciliation/import");
  check("GET /accounting/bank-reconciliation/import succeeds", importPageRes.ok, `status=${importPageRes.status}`);
  check("Import page has the heading", importHtml.includes(">Import bank statement<"), "heading present");
  for (const id of ["accountId", "file", "periodStart", "periodEnd", "openingBalance", "closingBalance"]) {
    check(`Import form has an input/select with id="${id}"`, importHtml.includes(`id="${id}"`), `id="${id}" present`);
  }
  check(
    "The new reconcilable account appears as a rendered option in the account picker",
    appearsRendered(importHtml, `${account.code} — ${account.name}`),
    `looked for rendered ">${account.code} — ${account.name}<"`
  );

  // ============================================================
  // 2. dryRun preview: well-formed CSV, single Amount column — no
  //    accountId/period/balance fields needed for a dry run at all
  // ============================================================
  console.log("\n--- dryRun preview (well-formed CSV) ---");
  const depositAmount = roundCurrency(1500 + uniq);
  const feeAmount = 25;
  const opening1 = 1000;
  const closing1 = roundCurrency(opening1 + depositAmount - feeAmount);

  const csv1 = [
    "Date,Description,Amount,Reference",
    `2026-01-05,TEST ${stamp} deposit,${depositAmount},REF-${stamp}-A`,
    `2026-01-06,TEST ${stamp} fee,-${feeAmount},`,
  ].join("\r\n");

  const { res: dryRes1, json: dryJson1 } = await postCsv({ dryRun: "true" }, csv1);
  check(
    "dryRun=true parses the CSV and returns lines without requiring accountId/period/balances",
    dryRes1.status === 200 && dryJson1.data?.lines?.length === 2,
    `status=${dryRes1.status} body=${JSON.stringify(dryJson1)}`
  );
  check(
    "dryRun does not write a BankStatement row",
    (await db.bankStatement.count({ where: { accountId: account.id } })) === 0,
    "count=0 expected before any commit call"
  );

  // ============================================================
  // 3. dryRun preview: unrecognized headers -> needs_mapping, then resolved
  // ============================================================
  console.log("\n--- dryRun preview needing column mapping ---");
  const mappingAmount = roundCurrency(300 + uniq);
  const csv2 = [
    "Txn Date Code,Memo Text,Net Value",
    `2026-03-01,TEST ${stamp} unmapped headers,${mappingAmount}`,
  ].join("\r\n");

  const { res: dryRes2, json: dryJson2 } = await postCsv({ dryRun: "true" }, csv2);
  check(
    "dryRun on unrecognized headers returns 422 needsColumnMapping (same as a real commit attempt would)",
    dryRes2.status === 422 && dryJson2.needsColumnMapping === true && Array.isArray(dryJson2.headers),
    `status=${dryRes2.status} body=${JSON.stringify(dryJson2)}`
  );

  const { res: dryRes2b, json: dryJson2b } = await postCsv(
    {
      dryRun: "true",
      columnMapping: JSON.stringify({ date: "Txn Date Code", description: "Memo Text", amount: "Net Value" }),
    },
    csv2
  );
  check(
    "Supplying an explicit columnMapping resolves the same dryRun preview",
    dryRes2b.status === 200 && dryJson2b.data?.lines?.length === 1,
    `status=${dryRes2b.status} body=${JSON.stringify(dryJson2b)}`
  );

  // ============================================================
  // 4. Full commit (no dryRun) -> statement appears on the list page with
  //    the IMPORTED status badge and correct line-status counts
  // ============================================================
  console.log("\n--- Commit -> appears on the statement list page ---");
  const { res: commitRes, json: commitJson } = await postCsv(
    {
      accountId: account.id,
      periodStart,
      periodEnd,
      openingBalance: String(opening1),
      closingBalance: String(closing1),
    },
    csv1
  );
  check(
    "Committing (no dryRun) creates the statement",
    commitRes.status === 201 && commitJson.data?.lines?.length === 2,
    `status=${commitRes.status} body=${JSON.stringify(commitJson)}`
  );

  const { res: listRes, html: listHtml } = await page("/accounting/bank-reconciliation");
  check("GET /accounting/bank-reconciliation succeeds", listRes.ok, `status=${listRes.status}`);
  check(
    "List page has the heading and an Import statement link",
    listHtml.includes(">Bank Reconciliation<") && listHtml.includes("Import statement"),
    "heading + link present"
  );
  check(
    "The newly imported statement's account label appears rendered in the list",
    appearsRendered(listHtml, `${account.code} — ${account.name}`),
    `looked for rendered ">${account.code} — ${account.name}<"`
  );
  check(
    "The newly imported statement shows the Imported status badge (no lines matched/ignored yet)",
    appearsRendered(listHtml, "Imported"),
    'looked for rendered ">Imported<"'
  );

  // ============================================================
  // 5. Balance mismatch: clear error surfacing with the actual discrepancy,
  //    not just "import failed" — and the same numbers a client-side
  //    preview (computed from the dryRun lines) would have already shown
  // ============================================================
  console.log("\n--- Balance mismatch: clear discrepancy, not just 'import failed' ---");
  const opening3 = 0;
  const wrongClosing3 = mappingAmount + 1; // off by exactly 1.00 from the true sum
  const { res: mismatchRes, json: mismatchJson } = await postCsv(
    {
      accountId: account.id,
      periodStart,
      periodEnd,
      openingBalance: String(opening3),
      closingBalance: String(wrongClosing3),
      columnMapping: JSON.stringify({ date: "Txn Date Code", description: "Memo Text", amount: "Net Value" }),
    },
    csv2
  );
  check(
    "A balance mismatch is rejected with 400, not a generic failure",
    mismatchRes.status === 400,
    `status=${mismatchRes.status} body=${JSON.stringify(mismatchJson)}`
  );
  check(
    "The error message names the actual opening/sum/closing numbers, not just 'import failed'",
    typeof mismatchJson.error === "string" &&
      mismatchJson.error.includes(String(opening3)) &&
      mismatchJson.error.includes(String(mappingAmount)) &&
      mismatchJson.error.includes(String(wrongClosing3)),
    `error="${mismatchJson.error}"`
  );

  // The import UI's preview step computes this same discrepancy client-side
  // (from the dryRun-returned lines + the entered balances) before ever
  // calling commit — confirm that computation lands on the exact 1.00 this
  // server rejection is based on, so the preview step would have shown the
  // user the same actual number ahead of time.
  const clientLinesSum = roundCurrency(dryJson2b.data.lines.reduce((sum: number, l: { amount: number }) => sum + l.amount, 0));
  const clientExpectedClosing = roundCurrency(opening3 + clientLinesSum);
  const clientDiscrepancy = roundCurrency(clientExpectedClosing - wrongClosing3);
  check(
    "Client-side preview discrepancy math (opening + dryRun lines - closing) matches the server's rejection by exactly -1.00",
    clientDiscrepancy === -1,
    `clientExpectedClosing=${clientExpectedClosing} wrongClosing3=${wrongClosing3} discrepancy=${clientDiscrepancy}`
  );

  check(
    "The rejected mismatch attempt left no stray BankStatement row behind",
    (await db.bankStatement.count({ where: { openingBalance: opening3, closingBalance: wrongClosing3 } })) === 0,
    "count=0"
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
