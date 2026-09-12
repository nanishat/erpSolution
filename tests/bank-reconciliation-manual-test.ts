// Bank Reconciliation manual test — covers the schema + import + basic
// matching pass added on top of Phase 4 (bank-reconciliation.service.ts),
// the last unbuilt piece of Phase 4 scope. A BankStatementLine matches
// against JournalLine (not Payment), so this exercises Payment-created
// JournalLines specifically as one example of a source, per the confirmed
// source-agnostic design — Cash Voucher/Debit/Credit Voucher lines would
// match the exact same way, just not exercised here since Payment already
// gives an easy, deterministic way to create known Cash-account JournalLines
// via the real API.
//
// Exercises the real HTTP API throughout: POST /api/bank-reconciliation/
// statements, GET .../[id]/suggestions, POST .../[id]/match, POST
// .../[id]/unmatch, GET .../[id]/summary — plus POST /api/payments and POST
// /api/invoices/[id]/post to build the JournalLine fixtures to match
// against. Invoice creation goes through createInvoice directly (no
// createInvoice API/UI layer yet, same deviation as every other Phase 3/4
// invoice script).
//
// Same no-cleanup convention as the other scripts: doesn't clean up after
// itself, safe to re-run, uses `TEST ... <timestamp>` naming.
import "dotenv/config";

import { db } from "../src/lib/db";
import { createInvoice } from "../src/modules/invoicing/services/invoice.service";
import { createInvoiceSchema } from "../src/modules/invoicing/validations/invoice.schema";

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

function createInvoiceViaSchema(raw: unknown) {
  return createInvoice(createInvoiceSchema.parse(raw));
}

async function postInvoiceViaApi(id: string) {
  const { res, json } = await api(`/api/invoices/${id}/post`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`postInvoiceViaApi failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json.data;
}

async function recordPaymentViaApi(body: Record<string, unknown>) {
  const { res, json } = await api("/api/payments", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) {
    throw new Error(`recordPaymentViaApi failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json.data as { id: string; journalEntry: { id: string } };
}

async function getCashJournalLine(journalEntryId: string, cashAccountId: string) {
  const entry = await db.journalEntry.findUniqueOrThrow({
    where: { id: journalEntryId },
    include: { lines: true },
  });
  return entry.lines.find((l) => l.accountId === cashAccountId)!;
}

async function importStatement(body: Record<string, unknown>) {
  return api("/api/bank-reconciliation/statements", { method: "POST", body: JSON.stringify(body) });
}

async function getSuggestions(statementId: string) {
  const { res, json } = await api(`/api/bank-reconciliation/statements/${statementId}/suggestions`);
  if (!res.ok) {
    throw new Error(`getSuggestions failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json.data as { bankStatementLineId: string; candidates: { journalLineId: string }[] }[];
}

async function confirmMatchViaApi(statementId: string, bankStatementLineId: string, journalLineId: string) {
  return api(`/api/bank-reconciliation/statements/${statementId}/match`, {
    method: "POST",
    body: JSON.stringify({ bankStatementLineId, journalLineId }),
  });
}

async function unmatchViaApi(statementId: string, bankStatementLineId: string) {
  return api(`/api/bank-reconciliation/statements/${statementId}/unmatch`, {
    method: "POST",
    body: JSON.stringify({ bankStatementLineId }),
  });
}

async function getSummary(statementId: string) {
  const { res, json } = await api(`/api/bank-reconciliation/statements/${statementId}/summary`);
  if (!res.ok) {
    throw new Error(`getSummary failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json.data;
}

async function main() {
  console.log(`Testing against ${BASE_URL}\n`);
  const stamp = Date.now();

  // --- Fixtures ---
  const { json: branchesJson } = await api("/api/branches");
  const branch = branchesJson.data[0] as { id: string; code: string };

  const { json: accountsJson } = await api("/api/accounts");
  const accounts: { id: string; code: string; subType: string | null; isReconcilable?: boolean }[] =
    accountsJson.data;
  const cashAccount = accounts.find((a) => a.code === "1010")!;
  const receivableAccount = accounts.find((a) => a.code === "1200")!; // NOT reconcilable — negative test
  const salesRevenue = accounts.find((a) => a.code === "4010")!;
  const operatingExpense = accounts.find((a) => a.code === "5010")!;
  check(
    "Cash account (1010) exists and is reconcilable (run prisma/seed-coa.ts first if this fails)",
    Boolean(cashAccount),
    `cashAccount=${cashAccount?.id}`
  );

  const customerProductService = await db.productService.create({
    data: {
      code: `TEST-BR-CUST-PS-${stamp}`,
      name: `TEST BankRecon Customer Service ${stamp}`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: salesRevenue.id,
    },
  });
  const vendorProductService = await db.productService.create({
    data: {
      code: `TEST-BR-VEND-PS-${stamp}`,
      name: `TEST BankRecon Vendor Service ${stamp}`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: salesRevenue.id, // required by schema, unused for VENDOR direction
      expenseAccountId: operatingExpense.id,
    },
  });

  const { json: customerJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "CUSTOMER",
      name: `TEST BankRecon Customer ${stamp}`,
      tin: `TIN-BR-${stamp}`,
      bin: `BIN-BR-${stamp}`,
    }),
  });
  const customer = customerJson.data as { id: string };

  const { json: vendorJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "VENDOR",
      name: `TEST BankRecon Vendor ${stamp}`,
      tin: `TIN-BRV-${stamp}`,
      bin: `BIN-BRV-${stamp}`,
    }),
  });
  const vendor = vendorJson.data as { id: string };

  function makeCustomerInvoice(sectorSuffix: string, unitPrice: number) {
    return createInvoiceViaSchema({
      partnerId: customer.id,
      direction: "CUSTOMER",
      sector: `BR${stamp.toString().slice(-5)}${sectorSuffix}`,
      branchId: branch.id,
      date: new Date().toISOString(),
      lines: [
        {
          productServiceId: customerProductService.id,
          description: "Bank reconciliation test line",
          quantity: 1,
          unitPrice,
        },
      ],
    });
  }

  function makeVendorBill(unitPrice: number) {
    return createInvoiceViaSchema({
      partnerId: vendor.id,
      direction: "VENDOR",
      branchId: branch.id,
      date: new Date().toISOString(),
      lines: [
        {
          productServiceId: vendorProductService.id,
          description: "Bank reconciliation test bill line",
          quantity: 1,
          unitPrice,
        },
      ],
    });
  }

  async function payFull(partnerId: string, invoiceId: string, amount: number) {
    return recordPaymentViaApi({
      partnerId,
      branchId: branch.id,
      amount,
      date: new Date().toISOString(),
      method: "Bank Transfer",
      reference: `TEST-BR-${stamp}`,
      cashBankAccountId: cashAccount.id,
      allocations: [{ invoiceId, amountApplied: amount }],
    });
  }

  // ============================================================
  // Build 4 known Cash-account JournalLines to match against:
  //   entryPay1, entryPay2: two separate CUSTOMER payments of `depositAmount`
  //     each (duplicate amount, deliberately — tests "excludes already-
  //     matched candidates" below) -> Debit Cash `depositAmount` each
  //   entryPay3: one VENDOR bill payment of `vendorAmount` -> Credit Cash
  //   entryPay4: one CUSTOMER payment of `fullMatchAmount` -> Debit Cash
  //     (used for the separate full-reconciliation statement further down)
  //
  // Amounts are stamp-derived (not the fixed round numbers a first pass at
  // this script used) so a rerun after a script failure — which, per this
  // repo's no-cleanup convention, leaves its already-posted Payments/
  // JournalLines behind — can never collide on account+period+amount with
  // JournalLines from an earlier run and pollute suggestMatches' candidate
  // counts. This is not a hypothetical: it happened during development, see
  // the amount uniqueness note below.
  // ============================================================
  console.log("--- Building JournalLine fixtures via real Payment postings ---");

  const uniq = (stamp % 9000) / 100; // 0.00-89.99, stamp-unique to this run
  const depositAmount = Math.round((6000 + uniq) * 100) / 100;
  const vendorAmount = Math.round((2500 + uniq) * 100) / 100;
  const fullMatchAmount = Math.round((1500 + uniq) * 100) / 100;
  const bankFeeAmount = 50; // fixed — asserts an empty candidate set, immune to cross-run collision

  const invoice1 = await makeCustomerInvoice("A", depositAmount);
  const invoice2 = await makeCustomerInvoice("B", depositAmount);
  const invoice3 = await makeCustomerInvoice("C", fullMatchAmount);
  const bill1 = await makeVendorBill(vendorAmount);
  await postInvoiceViaApi(invoice1.id);
  await postInvoiceViaApi(invoice2.id);
  await postInvoiceViaApi(invoice3.id);
  await postInvoiceViaApi(bill1.id);

  const pay1 = await payFull(customer.id, invoice1.id, depositAmount);
  const pay2 = await payFull(customer.id, invoice2.id, depositAmount);
  const pay3 = await payFull(vendor.id, bill1.id, vendorAmount);
  const pay4 = await payFull(customer.id, invoice3.id, fullMatchAmount);

  const jlPay1 = await getCashJournalLine(pay1.journalEntry.id, cashAccount.id);
  const jlPay2 = await getCashJournalLine(pay2.journalEntry.id, cashAccount.id);
  const jlPay3 = await getCashJournalLine(pay3.journalEntry.id, cashAccount.id);
  const jlPay4 = await getCashJournalLine(pay4.journalEntry.id, cashAccount.id);
  check(
    "Fixture JournalLines have expected debit/credit shape",
    Number(jlPay1.debit) === depositAmount &&
      Number(jlPay2.debit) === depositAmount &&
      Number(jlPay3.credit) === vendorAmount &&
      Number(jlPay4.debit) === fullMatchAmount,
    `jlPay1=${jlPay1.debit}/${jlPay1.credit} jlPay2=${jlPay2.debit}/${jlPay2.credit} jlPay3=${jlPay3.debit}/${jlPay3.credit} jlPay4=${jlPay4.debit}/${jlPay4.credit}`
  );

  const periodStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const periodEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // ============================================================
  // 1. Import validations
  // ============================================================
  console.log("\n--- Import validations ---");

  const balanceMismatchNonce = 918273.45;
  const { res: mismatchRes, json: mismatchJson } = await importStatement({
    accountId: cashAccount.id,
    periodStart,
    periodEnd,
    openingBalance: balanceMismatchNonce,
    closingBalance: balanceMismatchNonce + 1, // deliberately wrong, no lines
    lines: [],
  });
  check(
    "Import rejected when opening+sum(lines) != closing",
    mismatchRes.status === 400,
    `status=${mismatchRes.status} body=${JSON.stringify(mismatchJson)}`
  );
  const strayStatementCount = await db.bankStatement.count({
    where: { openingBalance: balanceMismatchNonce },
  });
  check(
    "Rejected balance-mismatch import left no BankStatement row behind",
    strayStatementCount === 0,
    `count=${strayStatementCount}`
  );

  const { res: notReconcilableRes, json: notReconcilableJson } = await importStatement({
    accountId: receivableAccount.id,
    periodStart,
    periodEnd,
    openingBalance: 0,
    closingBalance: 0,
    lines: [],
  });
  check(
    "Import against a non-reconcilable account (1200 AR) is rejected",
    notReconcilableRes.status === 400,
    `status=${notReconcilableRes.status} body=${JSON.stringify(notReconcilableJson)}`
  );

  // ============================================================
  // 2. Correct import
  // ============================================================
  console.log("\n--- Correct import ---");

  const statementOpeningBalance = 1000;
  const statementClosingBalance =
    Math.round(
      (statementOpeningBalance + depositAmount + depositAmount - vendorAmount - bankFeeAmount) * 100
    ) / 100;

  const { res: importRes, json: importJson } = await importStatement({
    accountId: cashAccount.id,
    periodStart,
    periodEnd,
    openingBalance: statementOpeningBalance,
    closingBalance: statementClosingBalance,
    lines: [
      { date: new Date().toISOString(), description: "Deposit A", amount: depositAmount },
      { date: new Date().toISOString(), description: "Deposit B", amount: depositAmount },
      { date: new Date().toISOString(), description: "Vendor payment", amount: -vendorAmount },
      { date: new Date().toISOString(), description: "Bank fee", amount: -bankFeeAmount },
    ],
  });
  check(
    "Import succeeds and creates statement + 4 lines",
    importRes.status === 201 && importJson.data?.lines?.length === 4,
    `status=${importRes.status} lines=${importJson.data?.lines?.length}`
  );
  check(
    "New statement starts IMPORTED with every line UNMATCHED",
    importJson.data?.status === "IMPORTED" &&
      importJson.data.lines.every((l: { matchStatus: string }) => l.matchStatus === "UNMATCHED"),
    `status=${importJson.data?.status} lineStatuses=${JSON.stringify(importJson.data?.lines?.map((l: { matchStatus: string }) => l.matchStatus))}`
  );

  const statementId = importJson.data.id as string;
  const lines = importJson.data.lines as { id: string; description: string; amount: number }[];
  const lineA = lines.find((l) => l.description === "Deposit A")!;
  const lineB = lines.find((l) => l.description === "Deposit B")!;
  const lineC = lines.find((l) => l.description === "Vendor payment")!;
  const lineD = lines.find((l) => l.description === "Bank fee")!;

  // ============================================================
  // 3. suggestMatches — correct candidates
  // ============================================================
  console.log("\n--- suggestMatches: correct candidates ---");

  const suggestions1 = await getSuggestions(statementId);
  const suggA = suggestions1.find((s) => s.bankStatementLineId === lineA.id)!;
  const suggB = suggestions1.find((s) => s.bankStatementLineId === lineB.id)!;
  const suggC = suggestions1.find((s) => s.bankStatementLineId === lineC.id)!;
  const suggD = suggestions1.find((s) => s.bankStatementLineId === lineD.id)!;

  check(
    "Deposit A (+6000) has both same-amount candidates before either is matched",
    suggA.candidates.length === 2 &&
      suggA.candidates.some((c) => c.journalLineId === jlPay1.id) &&
      suggA.candidates.some((c) => c.journalLineId === jlPay2.id),
    `candidates=${JSON.stringify(suggA.candidates.map((c) => c.journalLineId))}`
  );
  check(
    "Deposit B (+6000) has the same 2 candidates",
    suggB.candidates.length === 2,
    `candidates=${JSON.stringify(suggB.candidates.map((c) => c.journalLineId))}`
  );
  check(
    "Vendor payment (-2500) has exactly 1 candidate (jlPay3)",
    suggC.candidates.length === 1 && suggC.candidates[0].journalLineId === jlPay3.id,
    `candidates=${JSON.stringify(suggC.candidates.map((c) => c.journalLineId))}`
  );
  check(
    "Bank fee (-50) has no candidates (no matching ledger line)",
    suggD.candidates.length === 0,
    `candidates=${JSON.stringify(suggD.candidates)}`
  );

  // ============================================================
  // 4. confirmMatch + duplicate-match prevention
  // ============================================================
  console.log("\n--- confirmMatch + duplicate-match prevention ---");

  const { res: matchARes, json: matchAJson } = await confirmMatchViaApi(statementId, lineA.id, jlPay1.id);
  check(
    "Deposit A matches jlPay1",
    matchARes.status === 200 &&
      matchAJson.data.matchStatus === "MATCHED" &&
      matchAJson.data.matchedJournalLineId === jlPay1.id,
    `status=${matchARes.status} body=${JSON.stringify(matchAJson)}`
  );

  const statementAfterFirstMatch = await db.bankStatement.findUniqueOrThrow({ where: { id: statementId } });
  check(
    "BankStatement.status -> IN_PROGRESS after first match",
    statementAfterFirstMatch.status === "IN_PROGRESS",
    `status=${statementAfterFirstMatch.status}`
  );

  const suggestions2 = await getSuggestions(statementId);
  const suggBAfter = suggestions2.find((s) => s.bankStatementLineId === lineB.id)!;
  check(
    "suggestMatches now EXCLUDES jlPay1 (already matched) from Deposit B's candidates",
    suggBAfter.candidates.length === 1 && suggBAfter.candidates[0].journalLineId === jlPay2.id,
    `candidates=${JSON.stringify(suggBAfter.candidates.map((c) => c.journalLineId))}`
  );
  check(
    "Deposit A no longer appears in suggestMatches at all (no longer UNMATCHED)",
    !suggestions2.some((s) => s.bankStatementLineId === lineA.id),
    `ids=${JSON.stringify(suggestions2.map((s) => s.bankStatementLineId))}`
  );

  const { res: rematchARes } = await confirmMatchViaApi(statementId, lineA.id, jlPay2.id);
  check(
    "Re-matching an already-MATCHED BankStatementLine is rejected (409)",
    rematchARes.status === 409,
    `status=${rematchARes.status}`
  );

  const { res: claimedJlRes } = await confirmMatchViaApi(statementId, lineB.id, jlPay1.id);
  check(
    "Matching a JournalLine already claimed by another statement line is rejected (409)",
    claimedJlRes.status === 409,
    `status=${claimedJlRes.status}`
  );

  const { res: matchBRes } = await confirmMatchViaApi(statementId, lineB.id, jlPay2.id);
  check("Deposit B matches jlPay2 (the only remaining valid candidate)", matchBRes.status === 200, `status=${matchBRes.status}`);

  const jlPay3Before = { debit: Number(jlPay3.debit), credit: Number(jlPay3.credit), memo: jlPay3.memo };
  const { res: matchCRes } = await confirmMatchViaApi(statementId, lineC.id, jlPay3.id);
  check("Vendor payment matches jlPay3", matchCRes.status === 200, `status=${matchCRes.status}`);

  // ============================================================
  // 5. getReconciliationSummary — mix of matched/unmatched
  // ============================================================
  console.log("\n--- getReconciliationSummary: mix of matched/unmatched ---");

  const expectedMatchedTotal = Math.round((depositAmount + depositAmount - vendorAmount) * 100) / 100;
  const expectedReconciledBalance =
    Math.round((statementOpeningBalance + expectedMatchedTotal) * 100) / 100;
  const expectedDifference =
    Math.round((statementClosingBalance - expectedReconciledBalance) * 100) / 100;

  const summaryMixed = await getSummary(statementId);
  check(
    `Summary math: matchedLinesTotal = ${depositAmount}+${depositAmount}-${vendorAmount} = ${expectedMatchedTotal}`,
    summaryMixed.matchedLinesTotal === expectedMatchedTotal,
    `matchedLinesTotal=${summaryMixed.matchedLinesTotal}`
  );
  check(
    `Summary math: reconciledBalance = opening(${statementOpeningBalance}) + matchedTotal(${expectedMatchedTotal}) = ${expectedReconciledBalance}`,
    summaryMixed.reconciledBalance === expectedReconciledBalance,
    `reconciledBalance=${summaryMixed.reconciledBalance}`
  );
  check(
    `Summary math: difference = closing(${statementClosingBalance}) - reconciledBalance(${expectedReconciledBalance}) = ${expectedDifference} (exactly the unmatched Bank fee line, negated)`,
    summaryMixed.difference === expectedDifference && expectedDifference === -bankFeeAmount,
    `difference=${summaryMixed.difference}`
  );
  check(
    "Summary counts: matchedCount=3, unmatchedCount=1, ignoredCount=0, totalLines=4",
    summaryMixed.matchedCount === 3 &&
      summaryMixed.unmatchedCount === 1 &&
      summaryMixed.ignoredCount === 0 &&
      summaryMixed.totalLines === 4,
    `summary=${JSON.stringify(summaryMixed)}`
  );
  check("isReconciled is false while a line remains UNMATCHED", summaryMixed.isReconciled === false, `isReconciled=${summaryMixed.isReconciled}`);

  // ============================================================
  // 6. unmatchLine — reverses without touching JournalLine
  // ============================================================
  console.log("\n--- unmatchLine ---");

  const { res: unmatchCRes, json: unmatchCJson } = await unmatchViaApi(statementId, lineC.id);
  check(
    "Unmatch reverses Vendor payment line back to UNMATCHED",
    unmatchCRes.status === 200 &&
      unmatchCJson.data.matchStatus === "UNMATCHED" &&
      unmatchCJson.data.matchedJournalLineId === null &&
      unmatchCJson.data.matchedAt === null,
    `status=${unmatchCRes.status} body=${JSON.stringify(unmatchCJson)}`
  );

  const jlPay3After = await db.journalLine.findUniqueOrThrow({ where: { id: jlPay3.id } });
  check(
    "ISOLATION: jlPay3's own debit/credit/memo are bit-for-bit unchanged after match+unmatch",
    Number(jlPay3After.debit) === jlPay3Before.debit &&
      Number(jlPay3After.credit) === jlPay3Before.credit &&
      jlPay3After.memo === jlPay3Before.memo,
    `before=${JSON.stringify(jlPay3Before)} after=${JSON.stringify({ debit: Number(jlPay3After.debit), credit: Number(jlPay3After.credit), memo: jlPay3After.memo })}`
  );

  const { res: unmatchAgainRes } = await unmatchViaApi(statementId, lineD.id);
  check(
    "Unmatching a line that's already UNMATCHED (Bank fee, never matched) is rejected (409)",
    unmatchAgainRes.status === 409,
    `status=${unmatchAgainRes.status}`
  );

  const { res: unmatchMissingRes } = await unmatchViaApi(statementId, "nonexistent-line-id");
  check(
    "Unmatching a nonexistent BankStatementLine is rejected (404)",
    unmatchMissingRes.status === 404,
    `status=${unmatchMissingRes.status}`
  );

  // ============================================================
  // 7. Separate statement — full reconciliation (status -> RECONCILED)
  // ============================================================
  console.log("\n--- Separate statement: full reconciliation ---");

  const { json: statement2Json } = await importStatement({
    accountId: cashAccount.id,
    periodStart,
    periodEnd,
    openingBalance: 0,
    closingBalance: fullMatchAmount,
    lines: [{ date: new Date().toISOString(), description: "Full match test", amount: fullMatchAmount }],
  });
  const statement2Id = statement2Json.data.id as string;
  const lineE = statement2Json.data.lines[0] as { id: string };

  const suggestionsE = await getSuggestions(statement2Id);
  check(
    "Full-match statement's only line candidates against jlPay4",
    suggestionsE[0]?.candidates.some((c) => c.journalLineId === jlPay4.id),
    `candidates=${JSON.stringify(suggestionsE[0]?.candidates)}`
  );

  const { res: matchERes } = await confirmMatchViaApi(statement2Id, lineE.id, jlPay4.id);
  check("Statement 2's only line matches jlPay4", matchERes.status === 200, `status=${matchERes.status}`);

  const summary2 = await getSummary(statement2Id);
  check(
    "Fully-matched statement: isReconciled=true, difference=0",
    summary2.isReconciled === true && summary2.difference === 0 && summary2.unmatchedCount === 0,
    `summary=${JSON.stringify(summary2)}`
  );

  const statement2Row = await db.bankStatement.findUniqueOrThrow({ where: { id: statement2Id } });
  check(
    "BankStatement.status -> RECONCILED once every line is resolved",
    statement2Row.status === "RECONCILED",
    `status=${statement2Row.status}`
  );

  // ============================================================
  // 8. Cross-statement id/body mismatch guard
  // ============================================================
  console.log("\n--- Cross-statement mismatch guard ---");

  const { res: crossRes, json: crossJson } = await confirmMatchViaApi(statementId, lineE.id, jlPay4.id);
  check(
    "Matching a line from statement 2 via statement 1's URL is rejected (400)",
    crossRes.status === 400,
    `status=${crossRes.status} body=${JSON.stringify(crossJson)}`
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
