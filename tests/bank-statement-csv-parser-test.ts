// Pure unit-style test for parseBankStatementCsv (Part C: CSV parsing that
// feeds INTO the existing importBankStatement). Unlike every other script in
// this directory, this one needs neither the dev server nor the dev DB —
// parseBankStatementCsv is a pure function — so it's fast and safe to run in
// any environment. Run with `npx tsx tests/bank-statement-csv-parser-test.ts`.
//
// Covers the four scenarios this feature was asked to prove: a well-formed
// CSV (single Amount column), a CSV needing manual column mapping, a CSV
// with separate Debit/Credit columns converting to the correct sign, and
// malformed/oversized input being rejected cleanly. Plus a few smaller edge
// cases (quoted fields, parenthesized negatives, explicit columnMapping).
import {
  CsvColumnMappingError,
  CsvFileTooLargeError,
  CsvMalformedRowError,
  CsvTooManyRowsError,
  MAX_CSV_DATA_ROWS,
  parseBankStatementCsv,
} from "../src/modules/bank-reconciliation/utils/bank-statement-csv-parser";

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

function expectThrows(label: string, fn: () => unknown, errorClass: new (...args: never[]) => Error) {
  try {
    fn();
    check(label, false, "did not throw");
  } catch (e) {
    check(label, e instanceof errorClass, `threw ${e instanceof Error ? e.constructor.name : typeof e}: ${e instanceof Error ? e.message : e}`);
  }
}

function main() {
  // ============================================================
  // 1. Well-formed CSV, single signed Amount column
  // ============================================================
  console.log("--- Well-formed CSV (single Amount column) ---");

  const wellFormed = [
    "Date,Description,Amount,Reference",
    "2026-01-05,Deposit from customer,1500.50,REF-001",
    "2026-01-06,Vendor payment,-750.25,REF-002",
    '2026-01-07,"Fee, monthly",-25,',
  ].join("\r\n");

  const result1 = parseBankStatementCsv(wellFormed);
  check("Well-formed CSV parses to status ok", result1.status === "ok", `status=${result1.status}`);
  if (result1.status === "ok") {
    check("Well-formed CSV yields 3 lines", result1.lines.length === 3, `lines=${result1.lines.length}`);
    check(
      "Line 1: amount/description/reference round-trip correctly",
      result1.lines[0].amount === 1500.5 &&
        result1.lines[0].description === "Deposit from customer" &&
        result1.lines[0].referenceNo === "REF-001",
      JSON.stringify(result1.lines[0])
    );
    check(
      "Line 3: quoted field with embedded comma parses as one field, empty reference -> undefined",
      result1.lines[2].description === "Fee, monthly" &&
        result1.lines[2].amount === -25 &&
        result1.lines[2].referenceNo === undefined,
      JSON.stringify(result1.lines[2])
    );
  }

  // ============================================================
  // 2. Needs manual column mapping
  // ============================================================
  console.log("\n--- CSV needing manual column mapping ---");

  const ambiguousHeaders = ["Txn Ref,Notes,Value"].join("\r\n") + "\r\n1,foo,10";
  const result2 = parseBankStatementCsv(ambiguousHeaders);
  check(
    "Headers matching none of the known Date/Description/Amount variants -> needs_mapping",
    result2.status === "needs_mapping",
    `status=${result2.status} reason=${result2.status === "needs_mapping" ? result2.reason : "n/a"}`
  );
  if (result2.status === "needs_mapping") {
    check(
      "needs_mapping result carries the raw headers for a future mapping UI",
      JSON.stringify(result2.headers) === JSON.stringify(["Txn Ref", "Notes", "Value"]),
      `headers=${JSON.stringify(result2.headers)}`
    );
  }

  const bothAmountShapes = "Date,Description,Amount,Debit,Credit\r\n2026-01-01,x,10,,";
  const result2b = parseBankStatementCsv(bothAmountShapes);
  check(
    "Both a single Amount column AND Debit/Credit columns present -> needs_mapping (ambiguous, not guessed)",
    result2b.status === "needs_mapping",
    `status=${result2b.status}`
  );

  const ambiguousDate = "Date,Value Date,Description,Amount\r\n2026-01-01,2026-01-02,x,10";
  const result2c = parseBankStatementCsv(ambiguousDate);
  check(
    "Two columns both matching the 'date' variant list -> needs_mapping, not silently picking one",
    result2c.status === "needs_mapping",
    `status=${result2c.status} reason=${result2c.status === "needs_mapping" ? result2c.reason : "n/a"}`
  );

  // Providing an explicit columnMapping resolves the same ambiguous file.
  const resolvedViaMapping = parseBankStatementCsv(bothAmountShapes, {
    columnMapping: { date: "Date", description: "Description", amount: "Amount" },
  });
  check(
    "Explicit columnMapping resolves an otherwise-ambiguous file",
    resolvedViaMapping.status === "ok" && resolvedViaMapping.lines.length === 1 && resolvedViaMapping.lines[0].amount === 10,
    JSON.stringify(resolvedViaMapping)
  );

  expectThrows(
    "columnMapping naming a header that doesn't exist in the file is rejected",
    () =>
      parseBankStatementCsv(bothAmountShapes, {
        columnMapping: { date: "Date", description: "Description", amount: "Nonexistent Column" },
      }),
    CsvColumnMappingError
  );

  // ============================================================
  // 3. Debit/Credit columns -> signed amount conversion
  // ============================================================
  console.log("\n--- Debit/Credit sign conversion ---");

  const debitCreditCsv = [
    "Date,Description,Debit,Credit",
    "2026-02-01,Salary deposit,,5000.00",
    "2026-02-02,Rent payment,1200.00,",
    "2026-02-03,ATM withdrawal,(300.00),", // parenthesized negative in the Debit column itself
  ].join("\r\n");

  const result3 = parseBankStatementCsv(debitCreditCsv);
  check("Debit/Credit CSV auto-detects and parses to ok", result3.status === "ok", `status=${result3.status}`);
  if (result3.status === "ok") {
    check(
      "SIGN CONVENTION: Credit-only row -> positive (inflow) amount, exactly the credit value",
      result3.lines[0].amount === 5000,
      `amount=${result3.lines[0].amount}`
    );
    check(
      "SIGN CONVENTION: Debit-only row -> negative (outflow) amount, exactly -1 * debit value",
      result3.lines[1].amount === -1200,
      `amount=${result3.lines[1].amount}`
    );
    check(
      "A parenthesized (already-negative-looking) Debit value is normalized via abs() then re-negated -> still -300, not double-flipped to +300",
      result3.lines[2].amount === -300,
      `amount=${result3.lines[2].amount}`
    );
  }

  // ============================================================
  // 4. Malformed / oversized input rejected cleanly
  // ============================================================
  console.log("\n--- Malformed / oversized input ---");

  const raggedRow = "Date,Description,Amount\r\n2026-01-01,x,10\r\n2026-01-02,y"; // missing a column
  expectThrows(
    "A data row with fewer columns than the header row is rejected as malformed, not silently accepted",
    () => parseBankStatementCsv(raggedRow),
    CsvMalformedRowError
  );

  const oversizedContent = "x".repeat(3 * 1024 * 1024); // 3MB of filler, over the 2MB cap
  expectThrows("A file over the byte-size cap is rejected", () => parseBankStatementCsv(oversizedContent), CsvFileTooLargeError);

  const tooManyRowsHeader = "Date,Description,Amount\r\n";
  const tooManyRowsBody = Array.from({ length: MAX_CSV_DATA_ROWS + 1 }, (_, i) => `2026-01-01,row ${i},1`).join("\r\n");
  expectThrows(
    `A file with more than ${MAX_CSV_DATA_ROWS} data rows is rejected`,
    () => parseBankStatementCsv(tooManyRowsHeader + tooManyRowsBody),
    CsvTooManyRowsError
  );

  const atRowLimit = tooManyRowsHeader + Array.from({ length: MAX_CSV_DATA_ROWS }, (_, i) => `2026-01-01,row ${i},1`).join("\r\n");
  const resultAtLimit = parseBankStatementCsv(atRowLimit);
  check(`Exactly ${MAX_CSV_DATA_ROWS} data rows (the limit itself) is accepted`, resultAtLimit.status === "ok", `status=${resultAtLimit.status}`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exitCode = 1;
}

main();
