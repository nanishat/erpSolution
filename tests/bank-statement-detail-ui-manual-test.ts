// Bank Reconciliation statement DETAIL page UI manual test — covers
// /accounting/bank-reconciliation/[id] (BankStatementLineList.tsx +
// useBankStatementLineActions.ts), built on top of the confirmMatch/
// unmatchLine/ignoreLine/unignoreLine service+API layer already covered
// end-to-end by bank-reconciliation-manual-test.ts.
//
// Same convention as the other UI manual scripts (no headless-browser/JSDOM
// runner — see tests/README.md): fetches server-rendered HTML and asserts
// on markup via `appearsRendered` (`>value<`), not a raw substring search.
// The detail page's summary stats are deliberately rendered as one
// "Label: value" text node each (e.g. ">Matched: 2<") specifically so this
// kind of test can assert on an exact rendered string instead of a bare
// digit that could coincide with an unrelated number elsewhere on the page.
//
// Fixture recipe mirrors bank-reconciliation-manual-test.ts: a real POSTED
// Payment JournalLine on the seeded Cash account (1010) is the "deposit"
// candidate; a fixed-amount fee line with no JournalLine counterpart is the
// "no candidates" / ignore case.
//
// Same no-cleanup convention and `TEST ... <timestamp>` naming as the other
// scripts.
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

async function page(path: string) {
  const res = await fetch(`${BASE_URL}${path}`);
  const html = await res.text();
  return { res, html };
}

// Matches the actual rendered text node (`>value<`), not a bare substring
// that could appear anywhere else in the document.
function appearsRendered(html: string, text: string): boolean {
  return html.includes(`>${text}<`);
}

function createInvoiceViaSchema(raw: unknown) {
  return createInvoice(createInvoiceSchema.parse(raw));
}

async function getCashJournalLine(journalEntryId: string, cashAccountId: string) {
  const entry = await db.journalEntry.findUniqueOrThrow({
    where: { id: journalEntryId },
    include: { lines: true },
  });
  return entry.lines.find((l) => l.accountId === cashAccountId)!;
}

async function main() {
  console.log(`Testing against ${BASE_URL}\n`);
  const stamp = Date.now();
  const uniq = (stamp % 9000) / 100;

  // --- Fixtures: a real POSTED Cash-account JournalLine to match against ---
  const { json: branchesJson } = await api("/api/branches");
  const branch = branchesJson.data[0] as { id: string };

  const { json: accountsJson } = await api("/api/accounts");
  const accounts: { id: string; code: string; name: string; subType: string | null }[] = accountsJson.data;
  const cashAccount = accounts.find((a) => a.code === "1010")!;
  const salesRevenue = accounts.find((a) => a.code === "4010")!;
  check("Cash account (1010) exists (run prisma/seed-coa.ts first if this fails)", Boolean(cashAccount), `cashAccount=${cashAccount?.id}`);

  const productService = await db.productService.create({
    data: {
      code: `TEST-BRDUI-PS-${stamp}`,
      name: `TEST BRDUI Service ${stamp}`,
      type: "SERVICE",
      unitPrice: 0,
      incomeAccountId: salesRevenue.id,
    },
  });

  const { json: customerJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "CUSTOMER",
      name: `TEST BRDUI Customer ${stamp}`,
      tin: `TIN-BRDUI-${stamp}`,
      bin: `BIN-BRDUI-${stamp}`,
    }),
  });
  const customer = customerJson.data as { id: string };

  const depositAmount = Math.round((4000 + uniq) * 100) / 100;
  const feeAmount = 40; // fixed, deliberately no matching JournalLine

  const invoice = await createInvoiceViaSchema({
    partnerId: customer.id,
    direction: "CUSTOMER",
    sector: `BRDUI${stamp.toString().slice(-5)}`,
    branchId: branch.id,
    date: new Date().toISOString(),
    lines: [{ productServiceId: productService.id, description: "BRDUI test line", quantity: 1, unitPrice: depositAmount }],
  });
  await api(`/api/invoices/${invoice.id}/post`, { method: "POST" });

  const { json: paymentJson } = await api("/api/payments", {
    method: "POST",
    body: JSON.stringify({
      partnerId: customer.id,
      branchId: branch.id,
      amount: depositAmount,
      date: new Date().toISOString(),
      method: "Bank Transfer",
      reference: `TEST-BRDUI-${stamp}`,
      cashBankAccountId: cashAccount.id,
      allocations: [{ invoiceId: invoice.id, amountApplied: depositAmount }],
    }),
  });
  const payment = paymentJson.data as { journalEntry: { id: string } };
  const depositJournalLine = await getCashJournalLine(payment.journalEntry.id, cashAccount.id);
  check(
    "Fixture Payment posted a Debit Cash JournalLine for the deposit amount",
    Number(depositJournalLine.debit) === depositAmount,
    `debit=${depositJournalLine.debit}`
  );
  const depositEntry = await db.journalEntry.findUniqueOrThrow({ where: { id: payment.journalEntry.id } });

  // --- Import the statement: one line matches the fixture, one doesn't ---
  const periodStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const periodEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const opening = 1000;
  const closing = Math.round((opening + depositAmount - feeAmount) * 100) / 100;

  const { res: importRes, json: importJson } = await api("/api/bank-reconciliation/statements", {
    method: "POST",
    body: JSON.stringify({
      accountId: cashAccount.id,
      periodStart,
      periodEnd,
      openingBalance: opening,
      closingBalance: closing,
      lines: [
        { date: new Date().toISOString(), description: `TEST BRDUI deposit ${stamp}`, amount: depositAmount, referenceNo: `REF-${stamp}` },
        { date: new Date().toISOString(), description: `TEST BRDUI fee ${stamp}`, amount: -feeAmount },
      ],
    }),
  });
  check("Statement import succeeds with 2 lines", importRes.status === 201 && importJson.data?.lines?.length === 2, `status=${importRes.status}`);
  const statementId = importJson.data.id as string;
  const depositLine = importJson.data.lines.find((l: { amount: number }) => l.amount === depositAmount);
  const feeLine = importJson.data.lines.find((l: { amount: number }) => l.amount === -feeAmount);

  // ============================================================
  // 1. Detail page renders: header, Imported badge, initial summary, both
  //    lines UNMATCHED, deposit line's real candidate, fee line's empty set
  // ============================================================
  console.log("--- Detail page renders (initial, all UNMATCHED) ---");
  const { res: detailRes, html: detailHtml0 } = await page(`/accounting/bank-reconciliation/${statementId}`);
  check("GET /accounting/bank-reconciliation/[id] succeeds", detailRes.ok, `status=${detailRes.status}`);
  check(
    "Detail page heading shows the account label",
    appearsRendered(detailHtml0, `${cashAccount.code} — ${cashAccount.name}`),
    `looked for rendered ">${cashAccount.code} — ${cashAccount.name}<"`
  );
  check("Detail page shows the Imported status badge", appearsRendered(detailHtml0, "Imported"), 'looked for ">Imported<"');
  check("Initial summary: Matched: 0", appearsRendered(detailHtml0, "Matched: 0"), 'looked for ">Matched: 0<"');
  check("Initial summary: Unmatched: 2", appearsRendered(detailHtml0, "Unmatched: 2"), 'looked for ">Unmatched: 2<"');
  check("Initial summary: Ignored: 0", appearsRendered(detailHtml0, "Ignored: 0"), 'looked for ">Ignored: 0<"');
  check("Initial summary: Total lines: 2", appearsRendered(detailHtml0, "Total lines: 2"), 'looked for ">Total lines: 2<"');
  check(
    "The deposit line's real JournalLine candidate (document number) is rendered as a suggestion",
    appearsRendered(detailHtml0, `TEST BRDUI deposit ${stamp}`) && detailHtml0.includes(depositEntry.documentNumber),
    `looked for line description and documentNumber=${depositEntry.documentNumber}`
  );
  check(
    "The fee line (no matching JournalLine) shows 'No matching journal lines found'",
    detailHtml0.includes("No matching journal lines found"),
    "message present"
  );

  // ============================================================
  // 2. Confirm match on the deposit line -> Matched, summary updates
  // ============================================================
  console.log("\n--- Confirm match ---");
  const { res: matchRes } = await api(`/api/bank-reconciliation/statements/${statementId}/match`, {
    method: "POST",
    body: JSON.stringify({ bankStatementLineId: depositLine.id, journalLineId: depositJournalLine.id }),
  });
  check("Confirming the match succeeds", matchRes.status === 200, `status=${matchRes.status}`);

  const { html: detailHtml1 } = await page(`/accounting/bank-reconciliation/${statementId}`);
  check(
    "After match: deposit line shows 'Matched to <documentNumber>'",
    appearsRendered(detailHtml1, "In Progress") && detailHtml1.includes(`Matched to ${depositEntry.documentNumber}`),
    `looked for In Progress badge + 'Matched to ${depositEntry.documentNumber}'`
  );
  check("After match: Matched: 1", appearsRendered(detailHtml1, "Matched: 1"), 'looked for ">Matched: 1<"');
  check("After match: Unmatched: 1", appearsRendered(detailHtml1, "Unmatched: 1"), 'looked for ">Unmatched: 1<"');
  check("After match: Ignored: 0", appearsRendered(detailHtml1, "Ignored: 0"), 'looked for ">Ignored: 0<"');

  // ============================================================
  // 3. Ignore the fee line -> both lines resolved -> Reconciled
  // ============================================================
  console.log("\n--- Ignore ---");
  const { res: ignoreRes } = await api(`/api/bank-reconciliation/statements/${statementId}/ignore`, {
    method: "POST",
    body: JSON.stringify({ bankStatementLineId: feeLine.id }),
  });
  check("Ignoring the fee line succeeds", ignoreRes.status === 200, `status=${ignoreRes.status}`);

  const { html: detailHtml2 } = await page(`/accounting/bank-reconciliation/${statementId}`);
  check(
    "After ignore: statement badge is Reconciled (no UNMATCHED lines left)",
    appearsRendered(detailHtml2, "Reconciled"),
    'looked for ">Reconciled<"'
  );
  check("After ignore: fee line shows 'Ignored — excluded from matching.'", detailHtml2.includes("Ignored — excluded from matching."), "message present");
  check("After ignore: Matched: 1", appearsRendered(detailHtml2, "Matched: 1"), 'looked for ">Matched: 1<"');
  check("After ignore: Unmatched: 0", appearsRendered(detailHtml2, "Unmatched: 0"), 'looked for ">Unmatched: 0<"');
  check("After ignore: Ignored: 1", appearsRendered(detailHtml2, "Ignored: 1"), 'looked for ">Ignored: 1<"');

  // ============================================================
  // 4. Unmatch the deposit line -> back to UNMATCHED, In Progress again
  // ============================================================
  console.log("\n--- Unmatch ---");
  const { res: unmatchRes } = await api(`/api/bank-reconciliation/statements/${statementId}/unmatch`, {
    method: "POST",
    body: JSON.stringify({ bankStatementLineId: depositLine.id }),
  });
  check("Unmatching the deposit line succeeds", unmatchRes.status === 200, `status=${unmatchRes.status}`);

  const { html: detailHtml3 } = await page(`/accounting/bank-reconciliation/${statementId}`);
  check(
    "After unmatch: deposit line's 'Matched to' text is gone and its candidate resurfaces",
    !detailHtml3.includes(`Matched to ${depositEntry.documentNumber}`) && detailHtml3.includes(depositEntry.documentNumber),
    "matched-to text absent, candidate present again"
  );
  check("After unmatch: Matched: 0", appearsRendered(detailHtml3, "Matched: 0"), 'looked for ">Matched: 0<"');
  check("After unmatch: Unmatched: 1", appearsRendered(detailHtml3, "Unmatched: 1"), 'looked for ">Unmatched: 1<"');
  check("After unmatch: Ignored: 1", appearsRendered(detailHtml3, "Ignored: 1"), 'looked for ">Ignored: 1<"');
  check(
    "After unmatch: statement badge reverts to In Progress (one UNMATCHED line remains)",
    appearsRendered(detailHtml3, "In Progress"),
    'looked for ">In Progress<"'
  );

  // ============================================================
  // 5. Unignore the fee line -> back to UNMATCHED, Imported again
  // ============================================================
  console.log("\n--- Unignore ---");
  const { res: unignoreRes } = await api(`/api/bank-reconciliation/statements/${statementId}/unignore`, {
    method: "POST",
    body: JSON.stringify({ bankStatementLineId: feeLine.id }),
  });
  check("Unignoring the fee line succeeds", unignoreRes.status === 200, `status=${unignoreRes.status}`);

  const { html: detailHtml4 } = await page(`/accounting/bank-reconciliation/${statementId}`);
  check("After unignore: Matched: 0", appearsRendered(detailHtml4, "Matched: 0"), 'looked for ">Matched: 0<"');
  check("After unignore: Unmatched: 2", appearsRendered(detailHtml4, "Unmatched: 2"), 'looked for ">Unmatched: 2<"');
  check("After unignore: Ignored: 0", appearsRendered(detailHtml4, "Ignored: 0"), 'looked for ">Ignored: 0<"');
  check(
    "After unignore: statement badge reverts to Imported (nothing resolved)",
    appearsRendered(detailHtml4, "Imported"),
    'looked for ">Imported<"'
  );
  check(
    "After unignore: fee line's 'No matching journal lines found' message is back",
    detailHtml4.includes("No matching journal lines found"),
    "message present"
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
