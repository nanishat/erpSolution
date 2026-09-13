// Integration manual test for POST /api/bank-reconciliation/statements/import-csv
// (Part C: CSV parsing on top of the existing importBankStatement). Exercises
// the real multipart/form-data HTTP endpoint end-to-end — unlike
// bank-statement-csv-parser-test.ts (pure function, no server needed), this
// proves the whole pipeline: file upload -> CSV parse -> the SAME
// importBankStatementSchema + importBankStatement used by the JSON route.
//
// In particular, the Debit/Credit scenario below deliberately lets
// importBankStatement's own opening+sum(lines)==closing balance check be the
// proof that the sign conversion is correct — if debit/credit were flipped,
// that balance check (unchanged, reused as-is) would reject the import.
//
// Same conventions as the other scripts: doesn't clean up after itself, safe
// to re-run, uses `TEST ... <timestamp>` naming. See tests/README.md.
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

// Deliberately does NOT set a Content-Type header — fetch/undici derives
// the multipart boundary from the FormData body itself; forcing
// "application/json" (like the api() helper above does for every other
// script) would break the upload.
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

async function main() {
  console.log(`Testing against ${BASE_URL}\n`);
  const stamp = Date.now();

  const { json: accountsJson } = await api("/api/accounts");
  const accounts: { id: string; code: string }[] = accountsJson.data;
  const cashAccount = accounts.find((a) => a.code === "1010")!;
  check(
    "Cash account (1010) exists (run prisma/seed-coa.ts first if this fails)",
    Boolean(cashAccount),
    `cashAccount=${cashAccount?.id}`
  );

  const periodStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const periodEnd = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const uniq = (stamp % 9000) / 100;

  // ============================================================
  // 1. Well-formed CSV, single signed Amount column
  // ============================================================
  console.log("--- Well-formed CSV import ---");

  const depositAmount = Math.round((1500 + uniq) * 100) / 100;
  const feeAmount = 25;
  const opening1 = 1000;
  const closing1 = Math.round((opening1 + depositAmount - feeAmount) * 100) / 100;

  const csv1 = [
    "Date,Description,Amount,Reference",
    `2026-01-05,TEST ${stamp} deposit,${depositAmount},REF-${stamp}-A`,
    `2026-01-06,TEST ${stamp} fee,-${feeAmount},`,
  ].join("\r\n");

  const { res: res1, json: json1 } = await postCsv(
    {
      accountId: cashAccount.id,
      periodStart,
      periodEnd,
      openingBalance: String(opening1),
      closingBalance: String(closing1),
    },
    csv1
  );
  check(
    "Well-formed single-Amount-column CSV imports successfully with 2 lines",
    res1.status === 201 && json1.data?.lines?.length === 2,
    `status=${res1.status} body=${JSON.stringify(json1)}`
  );
  check(
    "Imported line amounts/reference round-trip correctly from the CSV",
    json1.data?.lines?.some((l: { amount: number; referenceNo: string | null }) => l.amount === depositAmount && l.referenceNo === `REF-${stamp}-A`),
    `lines=${JSON.stringify(json1.data?.lines)}`
  );

  // ============================================================
  // 2. Debit/Credit CSV -> sign conversion, proven via the reused balance check
  // ============================================================
  console.log("\n--- Debit/Credit CSV import (sign conversion) ---");

  const salaryCredit = Math.round((5000 + uniq) * 100) / 100;
  const rentDebit = Math.round((1200 + uniq) * 100) / 100;
  const opening2 = 0;
  // Credit = inflow = positive, Debit = outflow = negative -> closing =
  // opening + credit - debit. If the route had the sign backwards, this
  // exact-equality balance check inside importBankStatement (unmodified,
  // reused as-is) would reject the import with a 400.
  const closing2 = Math.round((opening2 + salaryCredit - rentDebit) * 100) / 100;

  const csv2 = [
    "Date,Description,Debit,Credit",
    `2026-02-01,TEST ${stamp} salary,,${salaryCredit}`,
    `2026-02-02,TEST ${stamp} rent,${rentDebit},`,
  ].join("\r\n");

  const { res: res2, json: json2 } = await postCsv(
    {
      accountId: cashAccount.id,
      periodStart,
      periodEnd,
      openingBalance: String(opening2),
      closingBalance: String(closing2),
    },
    csv2
  );
  check(
    "SIGN CONVENTION PROOF: Debit/Credit CSV imports successfully — the balance check only passes if credit->positive/debit->negative is correct",
    res2.status === 201 && json2.data?.lines?.length === 2,
    `status=${res2.status} body=${JSON.stringify(json2)}`
  );
  if (res2.status === 201) {
    const salaryLine = json2.data.lines.find((l: { description: string }) => l.description === `TEST ${stamp} salary`);
    const rentLine = json2.data.lines.find((l: { description: string }) => l.description === `TEST ${stamp} rent`);
    check(
      "Credit-only row stored as a positive amount",
      salaryLine?.amount === salaryCredit,
      `amount=${salaryLine?.amount}`
    );
    check(
      "Debit-only row stored as a negative amount",
      rentLine?.amount === -rentDebit,
      `amount=${rentLine?.amount}`
    );
  }

  // ============================================================
  // 3. Needs manual column mapping -> resolved by supplying columnMapping
  // ============================================================
  console.log("\n--- CSV needing manual column mapping ---");

  const mappingAmount = Math.round((300 + uniq) * 100) / 100;
  const csv3 = [
    "Txn Date Code,Memo Text,Net Value",
    `2026-03-01,TEST ${stamp} unmapped headers,${mappingAmount}`,
  ].join("\r\n");

  const { res: res3, json: json3 } = await postCsv(
    {
      accountId: cashAccount.id,
      periodStart,
      periodEnd,
      openingBalance: "0",
      closingBalance: String(mappingAmount),
    },
    csv3
  );
  check(
    "Unrecognized headers -> 422 needing manual column mapping, not a silent guess or a hard rejection",
    res3.status === 422 && json3.needsColumnMapping === true && Array.isArray(json3.headers),
    `status=${res3.status} body=${JSON.stringify(json3)}`
  );

  const { res: res3b, json: json3b } = await postCsv(
    {
      accountId: cashAccount.id,
      periodStart,
      periodEnd,
      openingBalance: "0",
      closingBalance: String(mappingAmount),
      columnMapping: JSON.stringify({ date: "Txn Date Code", description: "Memo Text", amount: "Net Value" }),
    },
    csv3
  );
  check(
    "Supplying an explicit columnMapping for the same file succeeds",
    res3b.status === 201 && json3b.data?.lines?.length === 1,
    `status=${res3b.status} body=${JSON.stringify(json3b)}`
  );

  // ============================================================
  // 4. Malformed / oversized files rejected cleanly, no stray row left behind
  // ============================================================
  console.log("\n--- Malformed / oversized rejection ---");

  const malformedNonce = 771122.33 + uniq;
  const malformedCsv = ["Date,Description,Amount", "2026-01-01,ok row,10", "2026-01-02,short row"].join("\r\n");
  const { res: res4, json: json4 } = await postCsv(
    {
      accountId: cashAccount.id,
      periodStart,
      periodEnd,
      openingBalance: String(malformedNonce),
      closingBalance: String(malformedNonce),
    },
    malformedCsv
  );
  check(
    "A CSV with a ragged (short) data row is rejected with a clean 400, not a 500 or a silently-wrong import",
    res4.status === 400,
    `status=${res4.status} body=${JSON.stringify(json4)}`
  );

  const oversizedNonce = 881133.44 + uniq;
  const oversizedCsv = "Date,Description,Amount\r\n" + "x".repeat(3 * 1024 * 1024);
  const { res: res5, json: json5 } = await postCsv(
    {
      accountId: cashAccount.id,
      periodStart,
      periodEnd,
      openingBalance: String(oversizedNonce),
      closingBalance: String(oversizedNonce),
    },
    oversizedCsv
  );
  check(
    "An oversized file (>2MB) is rejected with a clean 413, not accepted or a 500",
    res5.status === 413,
    `status=${res5.status} body=${JSON.stringify(json5)}`
  );

  const strayCount = await db.bankStatement.count({
    where: { openingBalance: { in: [malformedNonce, oversizedNonce] } },
  });
  check(
    "Neither rejected attempt left a stray BankStatement row behind",
    strayCount === 0,
    `count=${strayCount}`
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
