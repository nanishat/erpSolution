// Debit Voucher (multi-line + bank detail fields) manual test.
//
// Exercises the real HTTP API surface a browser client would call — POST
// /api/debit-vouchers, POST /api/journal-entries/[id]/post — rather than
// writing to the DB directly. Reference data (branch) is read directly via
// Prisma since there is no /api/branches-by-code lookup; accounts are read
// through GET /api/accounts, and the two extra expense-account fixtures this
// script needs are created through the real POST /api/accounts route (same
// convention as product-service-manual-test.ts).
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
type JournalLine = {
  accountId: string;
  debit: number | string;
  credit: number | string;
  memo: string | null;
};
type JournalEntryDetail = {
  id: string;
  status: string;
  bankName: string | null;
  chequeNo: string | null;
  chequeDate: string | null;
  lines: JournalLine[];
};

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

async function createExpenseAccount(code: string, name: string): Promise<Account> {
  const { res, json } = await api("/api/accounts", {
    method: "POST",
    body: JSON.stringify({ code, name, type: "EXPENSE", subType: "OPERATING_EXPENSE" }),
  });
  if (!res.ok) {
    throw new Error(`createExpenseAccount(${code}) failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json.data as Account;
}

async function createDebitVoucher(body: Record<string, unknown>) {
  return api("/api/debit-vouchers", { method: "POST", body: JSON.stringify(body) });
}

async function postEntry(id: string) {
  const { res, json } = await api(`/api/journal-entries/${id}/post`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`postEntry failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json.data as JournalEntryDetail;
}

async function main() {
  console.log(`Testing against ${BASE_URL}\n`);

  const branch = await db.branch.findFirstOrThrow({ where: { isHeadOffice: true } });

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
  const operatingExpenses = byCode("5010");

  const stamp = Date.now();
  const expense2 = await createExpenseAccount(`TEST-DV-${stamp}-1`, `TEST Rent Expense ${stamp}`);
  const expense3 = await createExpenseAccount(`TEST-DV-${stamp}-2`, `TEST Travel Expense ${stamp}`);
  console.log(`Created expense fixtures ${expense2.code}, ${expense3.code}`);

  // --- 1. Debit Voucher: 3 lines against 3 different expense accounts, shared Bank account ---
  const { res: bankRes, json: bankJson } = await createDebitVoucher({
    date: new Date().toISOString(),
    branchId: branch.id,
    description: "TEST: Multi-line expense payment via bank",
    cashBankAccountId: bank.id,
    bankName: "TEST Bank Ltd",
    chequeNo: `CHQ-${stamp}`,
    chequeDate: new Date().toISOString(),
    lines: [
      { expenseAccountId: operatingExpenses.id, amount: 100, description: "Line 1 expense" },
      { expenseAccountId: expense2.id, amount: 250, description: "Line 2 expense" },
      { expenseAccountId: expense3.id, amount: 75, description: "Line 3 expense" },
    ],
  });
  check("Create Debit Voucher (Bank account) succeeds", bankRes.ok, `status=${bankRes.status} body=${JSON.stringify(bankJson)}`);
  const bankVoucher = bankJson.data as JournalEntryDetail;

  check(
    "Bank voucher has exactly 4 lines (3 debit + 1 credit)",
    bankVoucher.lines.length === 4,
    `lines=${bankVoucher.lines.length}`
  );
  const bankDebitLines = bankVoucher.lines.filter((l) => Number(l.debit) > 0);
  const bankCreditLines = bankVoucher.lines.filter((l) => Number(l.credit) > 0);
  check("Bank voucher has 3 debit lines", bankDebitLines.length === 3, `debitLines=${bankDebitLines.length}`);
  check("Bank voucher has 1 credit line", bankCreditLines.length === 1, `creditLines=${bankCreditLines.length}`);

  const debitSum = bankDebitLines.reduce((sum, l) => sum + Number(l.debit), 0);
  const creditAmount = Number(bankCreditLines[0]?.credit ?? 0);
  check(
    "Debit sum equals credit amount",
    Math.round((debitSum - creditAmount) * 100) === 0 && debitSum === 425,
    `debitSum=${debitSum} creditAmount=${creditAmount}`
  );
  check(
    "Credit line is against the shared Bank account",
    bankCreditLines[0]?.accountId === bank.id,
    `accountId=${bankCreditLines[0]?.accountId} expected=${bank.id}`
  );
  check(
    "Bank detail fields stored",
    bankVoucher.bankName === "TEST Bank Ltd" &&
      bankVoucher.chequeNo === `CHQ-${stamp}` &&
      bankVoucher.chequeDate !== null,
    `bankName=${bankVoucher.bankName} chequeNo=${bankVoucher.chequeNo} chequeDate=${bankVoucher.chequeDate}`
  );

  const postedBankVoucher = await postEntry(bankVoucher.id);
  check("Bank voucher posts successfully", postedBankVoucher.status === "POSTED", `status=${postedBankVoucher.status}`);

  // --- 2. Same shape, but against a Cash-type account: bank fields must stay null, still posts ---
  const { res: cashRes, json: cashJson } = await createDebitVoucher({
    date: new Date().toISOString(),
    branchId: branch.id,
    description: "TEST: Multi-line expense payment via cash",
    cashBankAccountId: cash.id,
    lines: [
      { expenseAccountId: operatingExpenses.id, amount: 50, description: "Line 1 expense" },
      { expenseAccountId: expense2.id, amount: 60, description: "Line 2 expense" },
      { expenseAccountId: expense3.id, amount: 40, description: "Line 3 expense" },
    ],
  });
  check("Create Debit Voucher (Cash account) succeeds", cashRes.ok, `status=${cashRes.status} body=${JSON.stringify(cashJson)}`);
  const cashVoucher = cashJson.data as JournalEntryDetail;

  check(
    "Cash voucher bank fields are null",
    cashVoucher.bankName === null && cashVoucher.chequeNo === null && cashVoucher.chequeDate === null,
    `bankName=${cashVoucher.bankName} chequeNo=${cashVoucher.chequeNo} chequeDate=${cashVoucher.chequeDate}`
  );
  check("Cash voucher has exactly 4 lines (3 debit + 1 credit)", cashVoucher.lines.length === 4, `lines=${cashVoucher.lines.length}`);

  const postedCashVoucher = await postEntry(cashVoucher.id);
  check("Cash voucher posts successfully", postedCashVoucher.status === "POSTED", `status=${postedCashVoucher.status}`);

  // --- 3. Guard: a Bank account without bank detail fields is rejected server-side ---
  const { res: missingBankRes, json: missingBankJson } = await createDebitVoucher({
    date: new Date().toISOString(),
    branchId: branch.id,
    description: "TEST: should be rejected — Bank account without bank fields",
    cashBankAccountId: bank.id,
    lines: [{ expenseAccountId: operatingExpenses.id, amount: 10, description: "Line 1" }],
  });
  check(
    "Bank account without bank fields is rejected",
    missingBankRes.status === 400,
    `status=${missingBankRes.status} body=${JSON.stringify(missingBankJson)}`
  );

  // Fetch back from the DB source of truth to confirm nothing was persisted for the rejected attempt.
  const entryCountForRejected = await db.journalEntry.count({
    where: { description: "TEST: should be rejected — Bank account without bank fields" },
  });
  check("Rejected attempt left no JournalEntry row behind", entryCountForRejected === 0, `count=${entryCountForRejected}`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().finally(() => db.$disconnect());
