// Phase 1 (Core Ledger Engine) end-to-end manual test.
//
// Exercises the real HTTP API surface a browser client would call — POST
// /api/journal-entries, POST /api/journal-entries/[id]/post, POST
// /api/journal-entries/[id]/reverse, GET /api/reports/trial-balance — rather
// than writing to the DB directly. Reference data (branches) is read
// directly via Prisma since there is no /api/branches endpoint yet (see the
// Phase 1 review for that gap); accounts are read through GET /api/accounts.
//
// Requires the dev server running (`npm run dev`) at DEV_SERVER_URL
// (default http://localhost:3000).
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

type Account = { id: string; code: string; name: string; subType: string | null };

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

async function createEntry(body: Record<string, unknown>) {
  const { res, json } = await api("/api/journal-entries", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`createEntry failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json.data as {
    id: string;
    documentNumber: string;
    status: string;
    voucherType: string;
  };
}

async function postEntry(id: string) {
  const { res, json } = await api(`/api/journal-entries/${id}/post`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`postEntry failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json.data;
}

async function main() {
  console.log(`Testing against ${BASE_URL}\n`);

  // --- Reference data ---
  const branch = await db.branch.findFirstOrThrow({ where: { isHeadOffice: true } });
  const otherBranches = await db.branch.findMany({ where: { isHeadOffice: false } });
  if (otherBranches.length === 0) {
    console.log(
      "LIMITATION: only Head Office exists in this dev DB — no second branch to cross-branch test with. All entries below use Head Office."
    );
  }

  const { res: accountsRes, json: accountsJson } = await api("/api/accounts");
  check("GET /api/accounts succeeds", accountsRes.ok, `status=${accountsRes.status}`);
  const accounts: Account[] = accountsJson.data;
  const byCode = (code: string): Account => {
    const account = accounts.find((a) => a.code === code);
    if (!account) throw new Error(`Account code ${code} not found`);
    return account;
  };

  const cash = byCode("1010");
  const bank = byCode("1020");
  const ar = byCode("1200");
  const ap = byCode("2100");
  const suspense = byCode("1900");
  const salesRevenue = byCode("4010");
  const operatingExpenses = byCode("5010");

  // --- Baseline trial balance (before this run's test data) ---
  const { json: baselineJson } = await api("/api/reports/trial-balance");
  const baseline = baselineJson.data as {
    rows: { accountId: string; totalDebit: number; totalCredit: number }[];
    totalDebit: number;
    totalCredit: number;
    isBalanced: boolean;
  };
  console.log(
    `\nBaseline trial balance: totalDebit=${baseline.totalDebit} totalCredit=${baseline.totalCredit} isBalanced=${baseline.isBalanced}`
  );

  const line = (accountId: string, debit: number, credit: number, branchId = branch.id) => ({
    accountId,
    branchId,
    debit,
    credit,
  });

  // --- 1. Cash Voucher — money in (cash sale) ---
  const cashIn = await createEntry({
    date: new Date().toISOString(),
    description: "TEST: Cash sale receipt",
    branchId: branch.id,
    voucherType: "CASH_VOUCHER",
    lines: [line(cash.id, 1000, 0), line(salesRevenue.id, 0, 1000)],
  });
  console.log(`Created Cash Voucher (in) ${cashIn.documentNumber}`);

  // --- 2. Cash Voucher — money out (office supplies) ---
  const cashOut = await createEntry({
    date: new Date().toISOString(),
    description: "TEST: Office supplies cash purchase",
    branchId: branch.id,
    voucherType: "CASH_VOUCHER",
    lines: [line(operatingExpenses.id, 200, 0), line(cash.id, 0, 200)],
  });
  console.log(`Created Cash Voucher (out) ${cashOut.documentNumber}`);

  // --- 3. Debit Voucher — expense payment via bank ---
  const debitVoucher = await createEntry({
    date: new Date().toISOString(),
    description: "TEST: Utility bill payment via bank",
    branchId: branch.id,
    voucherType: "DEBIT_VOUCHER",
    lines: [line(operatingExpenses.id, 350, 0), line(bank.id, 0, 350)],
  });
  console.log(`Created Debit Voucher ${debitVoucher.documentNumber}`);

  // --- 4. Credit Voucher — income receipt into bank ---
  const creditVoucher = await createEntry({
    date: new Date().toISOString(),
    description: "TEST: Customer payment received into bank",
    branchId: branch.id,
    voucherType: "CREDIT_VOUCHER",
    lines: [line(bank.id, 800, 0), line(salesRevenue.id, 0, 800)],
  });
  console.log(`Created Credit Voucher ${creditVoucher.documentNumber}`);

  // --- 5. Journal Voucher — multi-line (3 accounts), includes Suspense ---
  const journalVoucher = await createEntry({
    date: new Date().toISOString(),
    description: "TEST: Unclassified receipt parked in Suspense pending categorization",
    branchId: branch.id,
    voucherType: "JOURNAL_VOUCHER",
    lines: [
      line(suspense.id, 150, 0),
      line(ar.id, 250, 0),
      line(ap.id, 0, 400),
    ],
  });
  console.log(`Created Journal Voucher ${journalVoucher.documentNumber}`);

  const allEntries = [cashIn, cashOut, debitVoucher, creditVoucher, journalVoucher];

  // --- Post every entry via the real posting endpoint ---
  console.log("\n--- Posting all 5 entries ---");
  for (const entry of allEntries) {
    const posted = await postEntry(entry.id);
    check(
      `${entry.documentNumber} posts DRAFT -> POSTED`,
      posted.status === "POSTED",
      `status=${posted.status}`
    );
  }

  // --- Reverse the Cash Voucher (out) entry ---
  console.log("\n--- Reversing Cash Voucher (out) ---");
  const { res: reverseRes, json: reverseJson } = await api(
    `/api/journal-entries/${cashOut.id}/reverse`,
    { method: "POST", body: JSON.stringify({ reason: "TEST: manual ledger test reversal" }) }
  );
  check("Reverse endpoint succeeds", reverseRes.ok, `status=${reverseRes.status}`);
  const { original, reversal } = reverseJson.data as {
    original: { id: string; status: string; lines: { accountId: string; debit: string; credit: string }[] };
    reversal: { id: string; status: string; lines: { accountId: string; debit: string; credit: string }[] };
  };

  // Confirm via the detail-page data source (GET /api/journal-entries/[id]), not the mutation response
  const { json: originalDetailJson } = await api(`/api/journal-entries/${cashOut.id}`);
  const { json: reversalDetailJson } = await api(`/api/journal-entries/${reversal.id}`);
  const originalDetail = originalDetailJson.data;
  const reversalDetail = reversalDetailJson.data;

  check(
    "Original entry shows VOID on its detail page",
    originalDetail.status === "VOID",
    `status=${originalDetail.status}`
  );
  check(
    "Reversal entry shows POSTED on its detail page",
    reversalDetail.status === "POSTED",
    `status=${reversalDetail.status}`
  );
  check(
    "Detail page links original <-> reversal",
    originalDetail.reversedByEntry?.id === reversal.id &&
      reversalDetail.reversalOfEntry?.id === cashOut.id,
    `original.reversedByEntry=${originalDetail.reversedByEntry?.id} reversal.reversalOfEntry=${reversalDetail.reversalOfEntry?.id}`
  );

  const swapped = originalDetail.lines.every((origLine: { accountId: string; debit: string; credit: string }) => {
    const match = reversalDetail.lines.find(
      (revLine: { accountId: string; debit: string; credit: string }) => revLine.accountId === origLine.accountId
    );
    return match && Number(match.debit) === Number(origLine.credit) && Number(match.credit) === Number(origLine.debit);
  });
  check("Reversal lines have debit/credit swapped per account vs. original", swapped, "");

  // --- Trial balance (no filters) ---
  console.log("\n--- Trial balance after all test entries + one reversal ---");
  const { json: tbJson } = await api("/api/reports/trial-balance");
  const tb = tbJson.data as {
    rows: { accountId: string; code: string; name: string; totalDebit: number; totalCredit: number; netBalance: number }[];
    totalDebit: number;
    totalCredit: number;
    isBalanced: boolean;
  };
  console.log(JSON.stringify(tb, null, 2));

  check(
    "Grand total debit = grand total credit (isBalanced)",
    tb.isBalanced && tb.totalDebit === tb.totalCredit,
    `totalDebit=${tb.totalDebit} totalCredit=${tb.totalCredit} isBalanced=${tb.isBalanced}`
  );

  const suspenseRow = tb.rows.find((r) => r.accountId === suspense.id);
  check(
    "Suspense Account appears with correct totals",
    suspenseRow?.totalDebit === (baseline.rows.find((r) => r.accountId === suspense.id)?.totalDebit ?? 0) + 150 &&
      suspenseRow?.totalCredit === (baseline.rows.find((r) => r.accountId === suspense.id)?.totalCredit ?? 0),
    `totalDebit=${suspenseRow?.totalDebit} totalCredit=${suspenseRow?.totalCredit}`
  );

  // Cash: net effect of the reversed cashOut entry should be zero, so Cash's
  // *net* activity from this run is just the 1000 debit from cashIn — but the
  // reversal still shows as gross debit/credit activity (200 credit original +
  // 200 debit reversal), so we check net movement, not raw totals, matches expectation.
  const cashRow = tb.rows.find((r) => r.accountId === cash.id);
  const cashBaseline = baseline.rows.find((r) => r.accountId === cash.id) ?? {
    totalDebit: 0,
    totalCredit: 0,
  };
  const cashNetMovement =
    (cashRow!.totalDebit - cashRow!.totalCredit) - (cashBaseline.totalDebit - cashBaseline.totalCredit);
  check(
    "Cash net movement reflects only the surviving Cash Voucher (in) — the reversed one nets to zero",
    cashNetMovement === 1000,
    `netMovement=${cashNetMovement} (expected 1000 from the 'in' voucher; the 'out' voucher's 200 was reversed)`
  );

  const otherAccounts = [
    { account: bank, label: "Bank", expectedDebitDelta: 800, expectedCreditDelta: 350 },
    { account: ar, label: "Accounts Receivable", expectedDebitDelta: 250, expectedCreditDelta: 0 },
    { account: ap, label: "Accounts Payable", expectedDebitDelta: 0, expectedCreditDelta: 400 },
    { account: salesRevenue, label: "Sales Revenue", expectedDebitDelta: 0, expectedCreditDelta: 1800 },
    // 200 debit (cashOut original, now VOID but still counted) + 350 debit
    // (debitVoucher) = 550; 200 credit (cashOut's reversal) is the other half
    // of that wash — it cancels the voided original's 200 debit on *net
    // balance*, but both sides still show up in the gross totals.
    { account: operatingExpenses, label: "Operating Expenses", expectedDebitDelta: 550, expectedCreditDelta: 200 },
  ];
  for (const { account, label, expectedDebitDelta, expectedCreditDelta } of otherAccounts) {
    const row = tb.rows.find((r) => r.accountId === account.id);
    const base = baseline.rows.find((r) => r.accountId === account.id) ?? { totalDebit: 0, totalCredit: 0 };
    const debitDelta = (row?.totalDebit ?? 0) - base.totalDebit;
    const creditDelta = (row?.totalCredit ?? 0) - base.totalCredit;
    check(
      `${label} shows expected activity from this run`,
      debitDelta === expectedDebitDelta && creditDelta === expectedCreditDelta,
      `debitDelta=${debitDelta} (expected ${expectedDebitDelta}) creditDelta=${creditDelta} (expected ${expectedCreditDelta})`
    );
  }

  // --- Branch filter: with only one branch, filtering by it should return
  // identical totals to unfiltered; filtering by a nonexistent branch id
  // should return an empty/zero report, proving the filter actually narrows. ---
  console.log("\n--- Trial balance branch filter ---");
  const { json: branchFilteredJson } = await api(
    `/api/reports/trial-balance?branchId=${branch.id}`
  );
  const branchFiltered = branchFilteredJson.data as typeof tb;
  check(
    "Filtering by the only real branch returns the same totals as unfiltered",
    branchFiltered.totalDebit === tb.totalDebit && branchFiltered.totalCredit === tb.totalCredit,
    `totalDebit=${branchFiltered.totalDebit} totalCredit=${branchFiltered.totalCredit}`
  );

  const { json: fakeBranchJson } = await api(
    `/api/reports/trial-balance?branchId=nonexistent-branch-id`
  );
  const fakeBranchFiltered = fakeBranchJson.data as typeof tb;
  check(
    "Filtering by a branch with no activity returns zero totals (filter actually narrows)",
    fakeBranchFiltered.totalDebit === 0 && fakeBranchFiltered.totalCredit === 0 && fakeBranchFiltered.rows.length === 0,
    `totalDebit=${fakeBranchFiltered.totalDebit} totalCredit=${fakeBranchFiltered.totalCredit} rows=${fakeBranchFiltered.rows.length}`
  );

  // --- Date filter: a range excluding today should exclude everything we just posted. ---
  console.log("\n--- Trial balance date filter ---");
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const isoDate = yesterday.toISOString().slice(0, 10);
  const { json: dateFilteredJson } = await api(
    `/api/reports/trial-balance?to=${isoDate}`
  );
  const dateFiltered = dateFilteredJson.data as typeof tb;
  check(
    "Filtering 'to' yesterday excludes today's test entries (narrows below unfiltered total)",
    dateFiltered.totalDebit < tb.totalDebit || (baseline.totalDebit === tb.totalDebit && dateFiltered.totalDebit === 0),
    `dateFiltered.totalDebit=${dateFiltered.totalDebit} vs unfiltered=${tb.totalDebit}`
  );

  const todayOnlyJson = (
    await api(`/api/reports/trial-balance?from=${new Date().toISOString().slice(0, 10)}`)
  ).json;
  const todayOnly = todayOnlyJson.data as typeof tb;
  check(
    "Filtering 'from' today includes today's test entries",
    todayOnly.totalDebit > 0,
    `totalDebit=${todayOnly.totalDebit}`
  );

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exitCode = 1;

  console.log("\nEntry IDs created by this run (for reference / cleanup):");
  console.log(JSON.stringify(allEntries.map((e) => ({ id: e.id, documentNumber: e.documentNumber })), null, 2));
  console.log(`Reversal entry: ${reversal.id} (${reversalDetail.documentNumber})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
