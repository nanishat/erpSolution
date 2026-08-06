// Phase 2 (Partners & Tax Engine) capstone integration test — walks the
// *actual* UI/API surface end to end, closing the loop across all three
// prompts that built Phase 2's tax tooling:
//
//   Prompt 1 (TaxRate admin UI)      -> POST /api/tax-rates, GET /accounting/tax-rates
//   Prompt 3 (Add Tax on a voucher)  -> POST /api/tax-applications, GET /accounting/journal-entries/[id]
//   Prompt 2 (Tax Approval Queue UI) -> POST /api/tax-applications/[id]/approve, GET /accounting/tax-applications
//
// Every mutation here goes through the same endpoint the corresponding form
// calls onSubmit — TaxRateForm, AddTaxApplicationForm, and
// TaxApplicationTable's Approve button, respectively — and every UI
// assertion fetches the real server-rendered page HTML (no headless
// browser/JSDOM runner wired up; same convention as
// phase2-partner-ui-manual-test.ts). This is what "no UI path existed"
// (flagged when this script was written) looks like once it's fixed.
//
// Also covers what phase3-tax-posting-manual-test.ts already covers at the
// API level (VAT/TDS posting -> Trial Balance -> reversal), but this script
// exists specifically to prove the *whole* Phase 2 surface — TaxRate admin,
// Add Tax, and the approval queue — is wired together, not just that the
// underlying service logic works.
//
// Requires prisma/seed-tax-accounts.ts to have been run first (VAT Payable/
// Receivable, TDS Payable accounts). Same no-cleanup convention as the other
// scripts: safe to re-run, `TEST ... <timestamp>` naming, Trial Balance
// assertions compare against a "before" snapshot taken immediately before
// each entry is created (this dev DB is shared and not reset between runs).
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

// Client components (TaxApplicationTable) receive their full, unfiltered
// data as props, and Next.js embeds that as a serialized RSC payload
// elsewhere in the same HTML document for hydration — so a plain substring
// search for a document number matches even when that row is correctly
// hidden from the *visible* table by the client-side status filter. Check
// for the rendered anchor text specifically (`>value<`) instead, which only
// appears in the actual server-rendered DOM, not the JSON-escaped payload.
function appearsRendered(html: string, text: string): boolean {
  return html.includes(`>${text}<`);
}

type Account = { id: string; code: string };
type TrialBalanceRow = {
  accountId: string;
  totalDebit: number;
  totalCredit: number;
  netBalance: number;
};

async function getTrialBalanceRow(accountId: string): Promise<TrialBalanceRow> {
  const { res, json } = await api("/api/reports/trial-balance?includeZeroBalances=true");
  if (!res.ok) {
    throw new Error(`trial balance fetch failed (${res.status}): ${JSON.stringify(json)}`);
  }
  const row = (json.data.rows as TrialBalanceRow[]).find((r) => r.accountId === accountId);
  return row ?? { accountId, totalDebit: 0, totalCredit: 0, netBalance: 0 };
}

async function createDraftEntry(
  branchId: string,
  debitAccountId: string,
  creditAccountId: string,
  amount: number,
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
        { accountId: debitAccountId, branchId, debit: amount, credit: 0 },
        { accountId: creditAccountId, branchId, debit: 0, credit: amount },
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
  const operatingExpense = accounts.find((a) => a.code === "5010")!;
  const vatPayable = accounts.find((a) => a.code === "2110")!;
  const tdsPayable = accounts.find((a) => a.code === "2120")!;

  check(
    "Tax accounts exist (run prisma/seed-tax-accounts.ts first if this fails)",
    Boolean(vatPayable && tdsPayable),
    `vatPayable=${vatPayable?.id} tdsPayable=${tdsPayable?.id}`
  );

  // ============================================================
  // PART A — VAT: real TaxRate admin UI -> Add Tax on a voucher -> approval
  // queue UI -> post -> Trial Balance -> reverse
  // ============================================================
  console.log("=== PART A: VAT (via TaxRate admin UI + Add Tax + Approval Queue UI) ===\n");

  console.log("--- 1. Enter a real VAT rate through the TaxRate admin API (what TaxRateForm submits) ---");
  const vatRateName = `TEST Integration Output VAT 15% ${stamp}`;
  const { res: taxRateRes, json: taxRateJson } = await api("/api/tax-rates", {
    method: "POST",
    body: JSON.stringify({
      type: "VAT",
      category: "Standard",
      name: vatRateName,
      ratePercent: 15,
      direction: "OUTPUT",
    }),
  });
  check("Create TaxRate succeeds", taxRateRes.status === 201, `status=${taxRateRes.status}`);
  const vatRate = taxRateJson.data as { id: string };

  const { html: taxRatesPageHtml } = await page("/accounting/tax-rates");
  check(
    "New VAT rate appears on the TaxRate admin list page",
    taxRatesPageHtml.includes(vatRateName),
    `looked for "${vatRateName}"`
  );

  console.log("\n--- 2. Create a voucher (sale-shaped: Cash debit / Sales Revenue credit) ---");
  const vatEntry = await createDraftEntry(
    branch.id,
    cash.id,
    salesRevenue.id,
    1000,
    `TEST full-integration vat-output ${stamp}`
  );

  const { html: entryPageBeforeTax } = await page(`/accounting/journal-entries/${vatEntry.id}`);
  check(
    "DRAFT entry's detail page offers Add tax",
    entryPageBeforeTax.includes("Add tax"),
    "button present"
  );

  console.log("\n--- 3. Attach the VAT TaxApplication (what AddTaxApplicationForm submits) ---");
  const { res: vatAppRes, json: vatAppJson } = await api("/api/tax-applications", {
    method: "POST",
    body: JSON.stringify({
      journalEntryId: vatEntry.id,
      taxType: "VAT",
      direction: "OUTPUT",
      sourceTaxRateId: vatRate.id,
      baseAmount: 1000,
    }),
  });
  check("Create VAT TaxApplication succeeds", vatAppRes.status === 201, `status=${vatAppRes.status}`);
  check(
    "taxAmount computed from the real TaxRate: 1000 * 15% = 150.00",
    Number(vatAppJson.data?.taxAmount) === 150,
    `taxAmount=${vatAppJson.data?.taxAmount}`
  );
  const vatApp = vatAppJson.data as { id: string };

  const { html: entryPageAfterTax } = await page(`/accounting/journal-entries/${vatEntry.id}`);
  check(
    "Entry detail page now shows the attached VAT line",
    entryPageAfterTax.includes(vatRateName) && entryPageAfterTax.includes("PENDING_REVIEW"),
    "tax section present"
  );

  console.log("\n--- 4. Posting before approval is blocked ---");
  const { res: blockedPostRes, json: blockedPostJson } = await api(
    `/api/journal-entries/${vatEntry.id}/post`,
    { method: "POST" }
  );
  check(
    "Posting is rejected with 409 while the tax application is PENDING_REVIEW",
    blockedPostRes.status === 409,
    `status=${blockedPostRes.status} body=${JSON.stringify(blockedPostJson)}`
  );

  const { html: queueHtmlBefore } = await page("/accounting/tax-applications");
  check(
    "The pending VAT application's entry shows up in the default (PENDING_REVIEW) approval queue's rendered table",
    appearsRendered(queueHtmlBefore, vatEntry.documentNumber),
    `looked for rendered ">${vatEntry.documentNumber}<"`
  );

  console.log("\n--- 5. Approve via the approval queue's endpoint (what its Approve button calls) ---");
  const { res: approveRes, json: approveJson } = await api(
    `/api/tax-applications/${vatApp.id}/approve`,
    { method: "POST" }
  );
  check("Approve succeeds", approveRes.ok, `status=${approveRes.status}`);
  check(
    "TaxApplication status is now APPROVED",
    approveJson.data?.status === "APPROVED",
    `status=${approveJson.data?.status}`
  );

  const { html: queueHtmlAfter } = await page("/accounting/tax-applications");
  check(
    "Approved entry no longer appears in the default (PENDING_REVIEW) approval queue's rendered table",
    !appearsRendered(queueHtmlAfter, vatEntry.documentNumber),
    `looked for absence of rendered ">${vatEntry.documentNumber}<"`
  );

  console.log("\n--- 6. Posting now succeeds; Trial Balance reflects VAT Payable ---");
  const vatPayableBefore = await getTrialBalanceRow(vatPayable.id);
  const cashBeforeVat = await getTrialBalanceRow(cash.id);
  const salesBefore = await getTrialBalanceRow(salesRevenue.id);

  const { res: vatPostRes, json: vatPostJson } = await api(
    `/api/journal-entries/${vatEntry.id}/post`,
    { method: "POST" }
  );
  check(
    "Posting now succeeds now that the tax application is APPROVED",
    vatPostRes.ok,
    `status=${vatPostRes.status} body=${JSON.stringify(vatPostJson)}`
  );

  const vatPayableAfterPost = await getTrialBalanceRow(vatPayable.id);
  const cashAfterPostVat = await getTrialBalanceRow(cash.id);
  const salesAfterPost = await getTrialBalanceRow(salesRevenue.id);

  console.log(
    `    Trial Balance — VAT Payable: totalDebit ${vatPayableBefore.totalDebit} -> ${vatPayableAfterPost.totalDebit}, ` +
      `totalCredit ${vatPayableBefore.totalCredit} -> ${vatPayableAfterPost.totalCredit}, ` +
      `netBalance ${vatPayableBefore.netBalance} -> ${vatPayableAfterPost.netBalance}`
  );
  console.log(
    `    Trial Balance — Cash: totalDebit ${cashBeforeVat.totalDebit} -> ${cashAfterPostVat.totalDebit}`
  );
  console.log(
    `    Trial Balance — Sales Revenue: totalCredit ${salesBefore.totalCredit} -> ${salesAfterPost.totalCredit}`
  );

  check(
    "VAT Payable credited exactly 150.00",
    vatPayableAfterPost.totalCredit - vatPayableBefore.totalCredit === 150,
    `delta=${vatPayableAfterPost.totalCredit - vatPayableBefore.totalCredit}`
  );
  check(
    "Cash debit extended by the tax amount: +1150 (1000 principal + 150 VAT)",
    cashAfterPostVat.totalDebit - cashBeforeVat.totalDebit === 1150,
    `delta=${cashAfterPostVat.totalDebit - cashBeforeVat.totalDebit}`
  );
  check(
    "Sales Revenue untouched by tax posting: still +1000, not 1150",
    salesAfterPost.totalCredit - salesBefore.totalCredit === 1000,
    `delta=${salesAfterPost.totalCredit - salesBefore.totalCredit}`
  );

  console.log("\n--- 7. Reverse: VAT Payable nets back to zero delta ---");
  const { res: vatReverseRes, json: vatReverseJson } = await api(
    `/api/journal-entries/${vatEntry.id}/reverse`,
    { method: "POST", body: JSON.stringify({ reason: "TEST: full-integration VAT reversal" }) }
  );
  check("Reverse succeeds", vatReverseRes.ok, `status=${vatReverseRes.status}`);
  check(
    "Original entry is VOID",
    vatReverseJson.data?.original?.status === "VOID",
    `status=${vatReverseJson.data?.original?.status}`
  );

  const vatPayableAfterReverse = await getTrialBalanceRow(vatPayable.id);
  console.log(
    `    Trial Balance — VAT Payable after reversal: netBalance ${vatPayableAfterReverse.netBalance} (pre-entry baseline was ${vatPayableBefore.netBalance})`
  );
  check(
    "VAT Payable nets back to its pre-entry balance (delta = 0)",
    vatPayableAfterReverse.netBalance === vatPayableBefore.netBalance,
    `before=${vatPayableBefore.netBalance} afterReverse=${vatPayableAfterReverse.netBalance}`
  );

  // ============================================================
  // PART B — TDS: manual rate, same Add Tax + Approval Queue UI path
  // ============================================================
  console.log("\n=== PART B: TDS (manual rate, via Add Tax + Approval Queue UI) ===\n");

  console.log("--- 1. Create a voucher (vendor-payment-shaped: Expense debit / Cash credit) ---");
  const tdsEntry = await createDraftEntry(
    branch.id,
    operatingExpense.id,
    cash.id,
    2000,
    `TEST full-integration tds ${stamp}`
  );

  console.log("\n--- 2. Attach the TDS TaxApplication (manual ratePercent — no admin TaxRate needed) ---");
  const { res: tdsAppRes, json: tdsAppJson } = await api("/api/tax-applications", {
    method: "POST",
    body: JSON.stringify({
      journalEntryId: tdsEntry.id,
      taxType: "TDS",
      ratePercent: 7.5,
      baseAmount: 2000,
    }),
  });
  check("Create TDS TaxApplication succeeds", tdsAppRes.status === 201, `status=${tdsAppRes.status}`);
  check(
    "taxAmount = 2000 * 7.5% = 150.00",
    Number(tdsAppJson.data?.taxAmount) === 150,
    `taxAmount=${tdsAppJson.data?.taxAmount}`
  );
  const tdsApp = tdsAppJson.data as { id: string };

  console.log("\n--- 3. Posting before approval is blocked (again, for TDS) ---");
  const { res: tdsBlockedRes } = await api(`/api/journal-entries/${tdsEntry.id}/post`, {
    method: "POST",
  });
  check(
    "Posting is rejected with 409 while the TDS application is PENDING_REVIEW",
    tdsBlockedRes.status === 409,
    `status=${tdsBlockedRes.status}`
  );

  console.log("\n--- 4. Approve via the approval queue's endpoint ---");
  const { res: tdsApproveRes, json: tdsApproveJson } = await api(
    `/api/tax-applications/${tdsApp.id}/approve`,
    { method: "POST" }
  );
  check("Approve succeeds", tdsApproveRes.ok, `status=${tdsApproveRes.status}`);
  check(
    "TDS TaxApplication status is now APPROVED",
    tdsApproveJson.data?.status === "APPROVED",
    `status=${tdsApproveJson.data?.status}`
  );

  console.log("\n--- 5. Posting now succeeds; Trial Balance reflects TDS Payable ---");
  const tdsPayableBefore = await getTrialBalanceRow(tdsPayable.id);
  const cashBeforeTds = await getTrialBalanceRow(cash.id);
  const expenseBeforeTds = await getTrialBalanceRow(operatingExpense.id);

  const { res: tdsPostRes, json: tdsPostJson } = await api(
    `/api/journal-entries/${tdsEntry.id}/post`,
    { method: "POST" }
  );
  check(
    "Posting now succeeds now that the TDS application is APPROVED",
    tdsPostRes.ok,
    `status=${tdsPostRes.status} body=${JSON.stringify(tdsPostJson)}`
  );

  const tdsPayableAfterPost = await getTrialBalanceRow(tdsPayable.id);
  const cashAfterPostTds = await getTrialBalanceRow(cash.id);
  const expenseAfterPostTds = await getTrialBalanceRow(operatingExpense.id);

  console.log(
    `    Trial Balance — TDS Payable: totalCredit ${tdsPayableBefore.totalCredit} -> ${tdsPayableAfterPost.totalCredit}, ` +
      `netBalance ${tdsPayableBefore.netBalance} -> ${tdsPayableAfterPost.netBalance}`
  );
  console.log(
    `    Trial Balance — Cash: totalCredit ${cashBeforeTds.totalCredit} -> ${cashAfterPostTds.totalCredit}, ` +
      `totalDebit ${cashBeforeTds.totalDebit} -> ${cashAfterPostTds.totalDebit}`
  );
  console.log(
    `    Trial Balance — Operating Expense: netBalance ${expenseBeforeTds.netBalance} -> ${expenseAfterPostTds.netBalance}`
  );

  check(
    "TDS Payable credited exactly 150.00",
    tdsPayableAfterPost.totalCredit - tdsPayableBefore.totalCredit === 150,
    `delta=${tdsPayableAfterPost.totalCredit - tdsPayableBefore.totalCredit}`
  );
  check(
    "Cash: full 2000 credit (gross) plus an offsetting 150 debit — net paid out 1850",
    cashAfterPostTds.totalCredit - cashBeforeTds.totalCredit === 2000 &&
      cashAfterPostTds.totalDebit - cashBeforeTds.totalDebit === 150,
    `creditDelta=${cashAfterPostTds.totalCredit - cashBeforeTds.totalCredit} debitDelta=${cashAfterPostTds.totalDebit - cashBeforeTds.totalDebit}`
  );
  check(
    "Expense recognized at the full 2000 (TDS withholding doesn't shrink it)",
    expenseAfterPostTds.netBalance - expenseBeforeTds.netBalance === 2000,
    `delta=${expenseAfterPostTds.netBalance - expenseBeforeTds.netBalance}`
  );

  console.log("\n--- 6. Reverse: TDS Payable nets back to zero delta ---");
  const { res: tdsReverseRes } = await api(`/api/journal-entries/${tdsEntry.id}/reverse`, {
    method: "POST",
    body: JSON.stringify({ reason: "TEST: full-integration TDS reversal" }),
  });
  check("Reverse succeeds", tdsReverseRes.ok, `status=${tdsReverseRes.status}`);

  const tdsPayableAfterReverse = await getTrialBalanceRow(tdsPayable.id);
  console.log(
    `    Trial Balance — TDS Payable after reversal: netBalance ${tdsPayableAfterReverse.netBalance} (pre-entry baseline was ${tdsPayableBefore.netBalance})`
  );
  check(
    "TDS Payable nets back to its pre-entry balance (delta = 0)",
    tdsPayableAfterReverse.netBalance === tdsPayableBefore.netBalance,
    `before=${tdsPayableBefore.netBalance} afterReverse=${tdsPayableAfterReverse.netBalance}`
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
