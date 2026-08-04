// Phase 3 (Tax Account Posting) manual test — the JournalLine posting logic
// in tax-posting.service.ts, wired into postJournalEntry's
// postJournalEntryWithClient.
//
// Exercises the real HTTP API: POST /api/journal-entries, POST
// /api/tax-applications, POST /api/tax-applications/[id]/approve, POST
// /api/journal-entries/[id]/post, POST /api/journal-entries/[id]/reverse,
// GET /api/reports/trial-balance. Requires prisma/seed-tax-accounts.ts to
// have been run first (VAT Payable/Receivable, TDS/VDS Payable accounts).
//
// Same conventions as the Phase 1/2 scripts: no cleanup, safe to re-run,
// `TEST ... <timestamp>` naming, and — since this dev DB is shared across
// runs — every Trial Balance assertion compares against a "before" snapshot
// captured just before the entry under test is created, not an assumed
// zero baseline.
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

async function createTaxApplication(body: Record<string, unknown>) {
  const { res, json } = await api("/api/tax-applications", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`createTaxApplication failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json.data as { id: string; taxAmount: string; status: string };
}

async function approveTaxApplication(id: string) {
  const { res, json } = await api(`/api/tax-applications/${id}/approve`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`approveTaxApplication failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json.data;
}

async function postEntry(id: string) {
  return api(`/api/journal-entries/${id}/post`, { method: "POST" });
}

async function reverseEntry(id: string, reason: string) {
  return api(`/api/journal-entries/${id}/reverse`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
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
  const vatReceivable = accounts.find((a) => a.code === "1210")!;
  const tdsPayable = accounts.find((a) => a.code === "2120")!;

  check(
    "Tax accounts exist (run prisma/seed-tax-accounts.ts first if this fails)",
    Boolean(vatPayable && vatReceivable && tdsPayable),
    `vatPayable=${vatPayable?.id} vatReceivable=${vatReceivable?.id} tdsPayable=${tdsPayable?.id}`
  );

  const outputVatRate = await db.taxRate.create({
    data: {
      type: "VAT",
      category: "Standard",
      name: `TEST Output VAT 15% ${stamp}`,
      ratePercent: 15,
      direction: "OUTPUT",
      computationType: "EXCLUSIVE",
    },
  });
  const inputVatRate = await db.taxRate.create({
    data: {
      type: "VAT",
      category: "Standard",
      name: `TEST Input VAT 15% ${stamp}`,
      ratePercent: 15,
      direction: "INPUT",
      computationType: "EXCLUSIVE",
    },
  });

  // ============================================================
  // 1. VAT OUTPUT: sale-shaped entry (Cash debit / Sales Revenue credit)
  // ============================================================
  console.log("--- VAT OUTPUT: post, trial balance, reverse ---");

  const vatPayableBefore = await getTrialBalanceRow(vatPayable.id);
  const cashBeforeOutput = await getTrialBalanceRow(cash.id);
  const salesBefore = await getTrialBalanceRow(salesRevenue.id);

  const outputEntry = await createDraftEntry(
    branch.id,
    cash.id,
    salesRevenue.id,
    1000,
    `TEST vat-output-posting ${stamp}`
  );
  const outputVatApp = await createTaxApplication({
    journalEntryId: outputEntry.id,
    taxType: "VAT",
    direction: "OUTPUT",
    sourceTaxRateId: outputVatRate.id,
    baseAmount: 1000,
  });
  check("Output VAT taxAmount = 150.00", Number(outputVatApp.taxAmount) === 150, `taxAmount=${outputVatApp.taxAmount}`);

  await approveTaxApplication(outputVatApp.id);

  const { res: outputPostRes, json: outputPostJson } = await postEntry(outputEntry.id);
  check(
    "Posting the VAT OUTPUT entry succeeds (tax lines added, still balanced)",
    outputPostRes.ok,
    `status=${outputPostRes.status} body=${JSON.stringify(outputPostJson)}`
  );

  const vatPayableAfterPost = await getTrialBalanceRow(vatPayable.id);
  const cashAfterPostOutput = await getTrialBalanceRow(cash.id);
  const salesAfterPost = await getTrialBalanceRow(salesRevenue.id);

  check(
    "VAT Payable credited 150.00 (Trial Balance)",
    vatPayableAfterPost.totalCredit - vatPayableBefore.totalCredit === 150,
    `before=${vatPayableBefore.totalCredit} after=${vatPayableAfterPost.totalCredit}`
  );
  check(
    "VAT Payable net balance increased by 150.00 (LIABILITY, credit-normal)",
    vatPayableAfterPost.netBalance - vatPayableBefore.netBalance === 150,
    `before=${vatPayableBefore.netBalance} after=${vatPayableAfterPost.netBalance}`
  );
  check(
    "Cash debit extended by tax amount: +1150 total (1000 principal + 150 VAT), not just 1000",
    cashAfterPostOutput.totalDebit - cashBeforeOutput.totalDebit === 1150,
    `before=${cashBeforeOutput.totalDebit} after=${cashAfterPostOutput.totalDebit}`
  );
  check(
    "Sales Revenue untouched by tax posting (still +1000 credit, not 1150)",
    salesAfterPost.totalCredit - salesBefore.totalCredit === 1000,
    `before=${salesBefore.totalCredit} after=${salesAfterPost.totalCredit}`
  );

  const { res: outputReverseRes, json: outputReverseJson } = await reverseEntry(
    outputEntry.id,
    "TEST: vat output posting reversal"
  );
  check("Reversing the VAT OUTPUT entry succeeds", outputReverseRes.ok, `status=${outputReverseRes.status}`);
  check(
    "Original entry is VOID after reversal",
    outputReverseJson.data?.original?.status === "VOID",
    `status=${outputReverseJson.data?.original?.status}`
  );

  const vatPayableAfterReverse = await getTrialBalanceRow(vatPayable.id);
  check(
    "VAT Payable nets back to its pre-entry balance after reversal (tax lines reversed along with the rest)",
    vatPayableAfterReverse.netBalance === vatPayableBefore.netBalance,
    `before=${vatPayableBefore.netBalance} afterReverse=${vatPayableAfterReverse.netBalance}`
  );

  const outputVatAppAfterReversal = await db.taxApplication.findUniqueOrThrow({
    where: { id: outputVatApp.id },
  });
  check(
    "Step 0 confirmed: TaxApplication.status is untouched by reversal (still APPROVED)",
    outputVatAppAfterReversal.status === "APPROVED",
    `status=${outputVatAppAfterReversal.status}`
  );
  check(
    "TaxApplication still points at the original (now-VOID) entry, not the reversal",
    outputVatAppAfterReversal.journalEntryId === outputEntry.id,
    `journalEntryId=${outputVatAppAfterReversal.journalEntryId}`
  );

  // ============================================================
  // 2. VAT INPUT: purchase-shaped entry (Expense debit / Cash credit)
  // ============================================================
  console.log("\n--- VAT INPUT: post, trial balance, reverse ---");

  const vatReceivableBefore = await getTrialBalanceRow(vatReceivable.id);
  const cashBeforeInput = await getTrialBalanceRow(cash.id);

  const inputEntry = await createDraftEntry(
    branch.id,
    operatingExpense.id,
    cash.id,
    1000,
    `TEST vat-input-posting ${stamp}`
  );
  const inputVatApp = await createTaxApplication({
    journalEntryId: inputEntry.id,
    taxType: "VAT",
    direction: "INPUT",
    sourceTaxRateId: inputVatRate.id,
    baseAmount: 1000,
  });
  await approveTaxApplication(inputVatApp.id);

  const { res: inputPostRes } = await postEntry(inputEntry.id);
  check("Posting the VAT INPUT entry succeeds", inputPostRes.ok, `status=${inputPostRes.status}`);

  const vatReceivableAfterPost = await getTrialBalanceRow(vatReceivable.id);
  const cashAfterPostInput = await getTrialBalanceRow(cash.id);
  check(
    "VAT Receivable debited 150.00 (Trial Balance)",
    vatReceivableAfterPost.totalDebit - vatReceivableBefore.totalDebit === 150,
    `before=${vatReceivableBefore.totalDebit} after=${vatReceivableAfterPost.totalDebit}`
  );
  check(
    "Cash credit extended by tax amount: +1150 total paid out (1000 principal + 150 input VAT)",
    cashAfterPostInput.totalCredit - cashBeforeInput.totalCredit === 1150,
    `before=${cashBeforeInput.totalCredit} after=${cashAfterPostInput.totalCredit}`
  );

  await reverseEntry(inputEntry.id, "TEST: vat input posting reversal");
  const vatReceivableAfterReverse = await getTrialBalanceRow(vatReceivable.id);
  check(
    "VAT Receivable nets back to its pre-entry balance after reversal",
    vatReceivableAfterReverse.netBalance === vatReceivableBefore.netBalance,
    `before=${vatReceivableBefore.netBalance} afterReverse=${vatReceivableAfterReverse.netBalance}`
  );

  // ============================================================
  // 3. TDS: vendor-payment-shaped entry (Expense debit / Cash credit)
  // ============================================================
  console.log("\n--- TDS: post, trial balance, reverse ---");

  const tdsPayableBefore = await getTrialBalanceRow(tdsPayable.id);
  const cashBeforeTds = await getTrialBalanceRow(cash.id);
  const expenseBeforeTds = await getTrialBalanceRow(operatingExpense.id);

  const tdsEntry = await createDraftEntry(
    branch.id,
    operatingExpense.id,
    cash.id,
    2000,
    `TEST tds-posting ${stamp}`
  );
  const tdsApp = await createTaxApplication({
    journalEntryId: tdsEntry.id,
    taxType: "TDS",
    ratePercent: 7.5,
    baseAmount: 2000,
  });
  check("TDS taxAmount = 150.00", Number(tdsApp.taxAmount) === 150, `taxAmount=${tdsApp.taxAmount}`);

  await approveTaxApplication(tdsApp.id);

  const { res: tdsPostRes, json: tdsPostJson } = await postEntry(tdsEntry.id);
  check(
    "Posting the TDS entry succeeds",
    tdsPostRes.ok,
    `status=${tdsPostRes.status} body=${JSON.stringify(tdsPostJson)}`
  );

  const tdsPayableAfterPost = await getTrialBalanceRow(tdsPayable.id);
  const cashAfterPostTds = await getTrialBalanceRow(cash.id);
  const expenseAfterPostTds = await getTrialBalanceRow(operatingExpense.id);

  check(
    "TDS Payable credited 150.00 (Trial Balance)",
    tdsPayableAfterPost.totalCredit - tdsPayableBefore.totalCredit === 150,
    `before=${tdsPayableBefore.totalCredit} after=${tdsPayableAfterPost.totalCredit}`
  );
  check(
    "Cash: full 2000 credit still recorded (gross vendor invoice) plus an offsetting 150 debit — net cash paid out is 1850, i.e. the vendor was paid net of TDS",
    cashAfterPostTds.totalCredit - cashBeforeTds.totalCredit === 2000 &&
      cashAfterPostTds.totalDebit - cashBeforeTds.totalDebit === 150,
    `creditDelta=${cashAfterPostTds.totalCredit - cashBeforeTds.totalCredit} debitDelta=${cashAfterPostTds.totalDebit - cashBeforeTds.totalDebit}`
  );
  check(
    "Cash net balance moved by exactly -1850 (2000 paid out less 150 withheld)",
    Math.round((cashAfterPostTds.netBalance - cashBeforeTds.netBalance) * 100) === -185000,
    `before=${cashBeforeTds.netBalance} after=${cashAfterPostTds.netBalance}`
  );
  check(
    "Expense recognized at the full 2000 (TDS withholding doesn't shrink the expense)",
    expenseAfterPostTds.netBalance - expenseBeforeTds.netBalance === 2000,
    `before=${expenseBeforeTds.netBalance} after=${expenseAfterPostTds.netBalance}`
  );

  const { res: tdsReverseRes } = await reverseEntry(tdsEntry.id, "TEST: tds posting reversal");
  check("Reversing the TDS entry succeeds", tdsReverseRes.ok, `status=${tdsReverseRes.status}`);

  const tdsPayableAfterReverse = await getTrialBalanceRow(tdsPayable.id);
  check(
    "TDS Payable nets back to its pre-entry balance after reversal",
    tdsPayableAfterReverse.netBalance === tdsPayableBefore.netBalance,
    `before=${tdsPayableBefore.netBalance} afterReverse=${tdsPayableAfterReverse.netBalance}`
  );

  const tdsAppAfterReversal = await db.taxApplication.findUniqueOrThrow({ where: { id: tdsApp.id } });
  check(
    "TDS TaxApplication.status also untouched by reversal (still APPROVED)",
    tdsAppAfterReversal.status === "APPROVED",
    `status=${tdsAppAfterReversal.status}`
  );

  // ============================================================
  // 4. Negative case: no cash/bank/AR/AP line to post tax against
  // ============================================================
  console.log("\n--- No settlement line: posting is rejected, not silently skipped ---");

  const noSettlementEntry = await createDraftEntry(
    branch.id,
    operatingExpense.id,
    salesRevenue.id, // neither line is CASH/BANK/RECEIVABLE/PAYABLE
    500,
    `TEST no-settlement-line ${stamp}`
  );
  const noSettlementApp = await createTaxApplication({
    journalEntryId: noSettlementEntry.id,
    taxType: "VDS",
    ratePercent: 5,
    baseAmount: 500,
  });
  await approveTaxApplication(noSettlementApp.id);

  const { res: noSettlementPostRes, json: noSettlementPostJson } = await postEntry(noSettlementEntry.id);
  check(
    "Posting is rejected with 400 when no settlement line can be resolved",
    noSettlementPostRes.status === 400,
    `status=${noSettlementPostRes.status} body=${JSON.stringify(noSettlementPostJson)}`
  );
  check(
    "Rejection message identifies the missing settlement line",
    typeof noSettlementPostJson.error === "string" &&
      noSettlementPostJson.error.includes("cash/bank/receivable/payable"),
    `error=${noSettlementPostJson.error}`
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
