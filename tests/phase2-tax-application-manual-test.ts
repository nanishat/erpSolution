// Phase 2 (Partners & Tax Engine) manual test — the VAT/TDS/VDS calculation
// service (tax-application.service.ts) and the posting gate wired into
// journal-entry.service.ts's postJournalEntry.
//
// Exercises the real HTTP API: POST /api/tax-applications, POST
// /api/tax-applications/[id]/approve, POST /api/tax-applications/[id]/reject,
// POST /api/journal-entries/[id]/post, POST /api/journal-entries/[id]/reverse.
// There's no admin CRUD API for TaxRate yet (out of scope for this prompt),
// so the one TaxRate fixture this script needs is created directly via
// Prisma — same convention as reading branches/accounts directly when no API
// exists for them yet (see phase1-ledger-manual-test.ts). Branches/accounts
// are read through GET /api/branches / GET /api/accounts; partners and
// journal entries are created through their real POST endpoints.
//
// Same no-cleanup convention as the other Phase 1/2 scripts: doesn't clean up
// after itself, safe to re-run, uses `TEST ... <timestamp>` naming.
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

  const vatRate = await db.taxRate.create({
    data: {
      type: "VAT",
      category: "Standard",
      name: `TEST Standard VAT 15% ${stamp}`,
      ratePercent: 15,
      direction: "OUTPUT",
      computationType: "EXCLUSIVE",
    },
  });

  const { json: exclusivePartnerJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "CUSTOMER",
      name: `TEST VAT-Exclusive Partner ${stamp}`,
      tin: `TIN-VATX-${stamp}`,
      bin: `BIN-VATX-${stamp}`,
      vatInclusiveInPrice: false,
    }),
  });
  const exclusivePartner = exclusivePartnerJson.data as { id: string };

  const { json: inclusivePartnerJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "CUSTOMER",
      name: `TEST VAT-Inclusive Partner ${stamp}`,
      tin: `TIN-VATI-${stamp}`,
      bin: `BIN-VATI-${stamp}`,
      vatInclusiveInPrice: true,
    }),
  });
  const inclusivePartner = inclusivePartnerJson.data as { id: string };

  const { json: exemptPartnerJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "VENDOR",
      name: `TEST TDS-Exempt Partner ${stamp}`,
      tin: `TIN-TDSEX-${stamp}`,
      bin: `BIN-TDSEX-${stamp}`,
      tdsExempt: true,
    }),
  });
  const exemptPartner = exemptPartnerJson.data as { id: string };

  // --- 1. VAT TaxApplication from a TaxRate: EXCLUSIVE ---
  console.log("--- VAT from TaxRate: EXCLUSIVE (no inclusive price flag) ---");
  const entryVatExclusive = await createDraftEntry(
    branch.id,
    cash.id,
    salesRevenue.id,
    `TEST vat-exclusive ${stamp}`
  );
  const { res: vatExclusiveRes, json: vatExclusiveJson } = await api("/api/tax-applications", {
    method: "POST",
    body: JSON.stringify({
      journalEntryId: entryVatExclusive.id,
      partnerId: exclusivePartner.id,
      taxType: "VAT",
      direction: "OUTPUT",
      sourceTaxRateId: vatRate.id,
      baseAmount: 1000,
    }),
  });
  check("Create VAT (exclusive) succeeds", vatExclusiveRes.status === 201, `status=${vatExclusiveRes.status} body=${JSON.stringify(vatExclusiveJson)}`);
  check(
    "VAT exclusive: ratePercent denormalized from TaxRate",
    Number(vatExclusiveJson.data?.ratePercent) === 15,
    `ratePercent=${vatExclusiveJson.data?.ratePercent}`
  );
  check(
    "VAT exclusive: computationType is EXCLUSIVE",
    vatExclusiveJson.data?.computationType === "EXCLUSIVE",
    `computationType=${vatExclusiveJson.data?.computationType}`
  );
  check(
    "VAT exclusive: taxAmount = baseAmount * rate/100 = 150.00",
    Number(vatExclusiveJson.data?.taxAmount) === 150,
    `taxAmount=${vatExclusiveJson.data?.taxAmount}`
  );
  check(
    "VAT exclusive: status starts PENDING_REVIEW",
    vatExclusiveJson.data?.status === "PENDING_REVIEW",
    `status=${vatExclusiveJson.data?.status}`
  );

  // --- 2. VAT TaxApplication from a TaxRate: INCLUSIVE (partner flag) ---
  console.log("\n--- VAT from TaxRate: INCLUSIVE (partner.vatInclusiveInPrice=true) ---");
  const entryVatInclusive = await createDraftEntry(
    branch.id,
    cash.id,
    salesRevenue.id,
    `TEST vat-inclusive ${stamp}`
  );
  const { res: vatInclusiveRes, json: vatInclusiveJson } = await api("/api/tax-applications", {
    method: "POST",
    body: JSON.stringify({
      journalEntryId: entryVatInclusive.id,
      partnerId: inclusivePartner.id,
      taxType: "VAT",
      direction: "OUTPUT",
      sourceTaxRateId: vatRate.id,
      baseAmount: 1150, // tax-inclusive gross; 1000 net + 150 tax at 15%
    }),
  });
  check("Create VAT (inclusive) succeeds", vatInclusiveRes.status === 201, `status=${vatInclusiveRes.status}`);
  check(
    "VAT inclusive: computationType is INCLUSIVE (from partner flag, not TaxRate default)",
    vatInclusiveJson.data?.computationType === "INCLUSIVE",
    `computationType=${vatInclusiveJson.data?.computationType}`
  );
  check(
    "VAT inclusive: taxAmount back-calculated = base*rate/(100+rate) = 150.00",
    Number(vatInclusiveJson.data?.taxAmount) === 150,
    `taxAmount=${vatInclusiveJson.data?.taxAmount}`
  );

  // --- 3. TDS TaxApplication with manual rate ---
  console.log("\n--- TDS manual rate ---");
  const entryTds = await createDraftEntry(
    branch.id,
    cash.id,
    salesRevenue.id,
    `TEST tds-manual ${stamp}`
  );
  const { res: tdsRes, json: tdsJson } = await api("/api/tax-applications", {
    method: "POST",
    body: JSON.stringify({
      journalEntryId: entryTds.id,
      partnerId: exclusivePartner.id,
      taxType: "TDS",
      ratePercent: 7.5,
      baseAmount: 2000,
    }),
  });
  check("Create TDS succeeds", tdsRes.status === 201, `status=${tdsRes.status} body=${JSON.stringify(tdsJson)}`);
  check(
    "TDS: ratePercent is the manually-given value, no TaxRate lookup",
    Number(tdsJson.data?.ratePercent) === 7.5 && tdsJson.data?.sourceTaxRateId === null,
    `ratePercent=${tdsJson.data?.ratePercent} sourceTaxRateId=${tdsJson.data?.sourceTaxRateId}`
  );
  check(
    "TDS: computationType defaults to EXCLUSIVE",
    tdsJson.data?.computationType === "EXCLUSIVE",
    `computationType=${tdsJson.data?.computationType}`
  );
  check(
    "TDS: taxAmount = 2000 * 7.5/100 = 150.00",
    Number(tdsJson.data?.taxAmount) === 150,
    `taxAmount=${tdsJson.data?.taxAmount}`
  );

  // --- 4. TDS creation rejected for a tdsExempt partner ---
  console.log("\n--- TDS rejected for tdsExempt partner ---");
  const entryTdsExempt = await createDraftEntry(
    branch.id,
    cash.id,
    salesRevenue.id,
    `TEST tds-exempt ${stamp}`
  );
  const { res: tdsExemptRes, json: tdsExemptJson } = await api("/api/tax-applications", {
    method: "POST",
    body: JSON.stringify({
      journalEntryId: entryTdsExempt.id,
      partnerId: exemptPartner.id,
      taxType: "TDS",
      ratePercent: 5,
      baseAmount: 1000,
    }),
  });
  check(
    "TDS creation for a tdsExempt partner is rejected with 409",
    tdsExemptRes.status === 409,
    `status=${tdsExemptRes.status} body=${JSON.stringify(tdsExemptJson)}`
  );
  check(
    "Rejection message names TDS-exempt as the reason",
    typeof tdsExemptJson.error === "string" && tdsExemptJson.error.includes("TDS-exempt"),
    `error=${tdsExemptJson.error}`
  );

  // --- 5. Posting is blocked while a TaxApplication is PENDING_REVIEW ---
  console.log("\n--- Posting gate: PENDING_REVIEW blocks posting ---");
  const entryGate = await createDraftEntry(
    branch.id,
    cash.id,
    salesRevenue.id,
    `TEST posting-gate ${stamp}`
  );
  const { json: gateTaxJson } = await api("/api/tax-applications", {
    method: "POST",
    body: JSON.stringify({
      journalEntryId: entryGate.id,
      taxType: "VDS",
      ratePercent: 5,
      baseAmount: 1000,
    }),
  });
  const gateTaxApplication = gateTaxJson.data as { id: string; status: string };
  check(
    "Gate TaxApplication created PENDING_REVIEW",
    gateTaxApplication.status === "PENDING_REVIEW",
    `status=${gateTaxApplication.status}`
  );

  const { res: blockedPostRes, json: blockedPostJson } = await api(
    `/api/journal-entries/${entryGate.id}/post`,
    { method: "POST" }
  );
  check(
    "Posting the entry while tax is PENDING_REVIEW is rejected with 409",
    blockedPostRes.status === 409,
    `status=${blockedPostRes.status} body=${JSON.stringify(blockedPostJson)}`
  );
  check(
    "Rejection message identifies PENDING_REVIEW as the blocker",
    typeof blockedPostJson.error === "string" && blockedPostJson.error.includes("PENDING_REVIEW"),
    `error=${blockedPostJson.error}`
  );

  // --- 6. Approve -> posting now succeeds ---
  console.log("\n--- Approve unblocks posting ---");
  const { res: approveRes, json: approveJson } = await api(
    `/api/tax-applications/${gateTaxApplication.id}/approve`,
    { method: "POST" }
  );
  check("Approve succeeds", approveRes.ok, `status=${approveRes.status}`);
  check(
    "TaxApplication status is now APPROVED",
    approveJson.data?.status === "APPROVED",
    `status=${approveJson.data?.status}`
  );

  const { res: postRes, json: postJson } = await api(`/api/journal-entries/${entryGate.id}/post`, {
    method: "POST",
  });
  check(
    "Posting now succeeds once the tax application is APPROVED",
    postRes.ok,
    `status=${postRes.status} body=${JSON.stringify(postJson)}`
  );
  check("Journal entry status is POSTED", postJson.data?.status === "POSTED", `status=${postJson.data?.status}`);

  // Approve/reject reject a non-PENDING_REVIEW TaxApplication (state guard).
  const { res: reapproveRes } = await api(
    `/api/tax-applications/${gateTaxApplication.id}/approve`,
    { method: "POST" }
  );
  check(
    "Re-approving an already-APPROVED tax application is rejected with 409",
    reapproveRes.status === 409,
    `status=${reapproveRes.status}`
  );

  // --- 7. Reverse the posted entry: TaxApplication stays APPROVED ---
  console.log("\n--- Reverse: TaxApplication status is left untouched (stays APPROVED) ---");
  const { res: reverseRes, json: reverseJson } = await api(
    `/api/journal-entries/${entryGate.id}/reverse`,
    { method: "POST", body: JSON.stringify({ reason: "TEST: tax-application reversal check" }) }
  );
  check("Reverse succeeds", reverseRes.ok, `status=${reverseRes.status}`);
  check(
    "Original entry is now VOID",
    reverseJson.data?.original?.status === "VOID",
    `status=${reverseJson.data?.original?.status}`
  );

  const taxApplicationAfterReversal = await db.taxApplication.findUniqueOrThrow({
    where: { id: gateTaxApplication.id },
  });
  check(
    "TaxApplication status is untouched by the reversal (still APPROVED)",
    taxApplicationAfterReversal.status === "APPROVED",
    `status=${taxApplicationAfterReversal.status}`
  );
  check(
    "TaxApplication still points at the original (now-VOID) journal entry, not the reversal",
    taxApplicationAfterReversal.journalEntryId === entryGate.id,
    `journalEntryId=${taxApplicationAfterReversal.journalEntryId}`
  );

  // --- 8. Reject flow (state guard, not in the required list but exercises the other half of approve/reject) ---
  console.log("\n--- Reject flow ---");
  const entryReject = await createDraftEntry(
    branch.id,
    cash.id,
    salesRevenue.id,
    `TEST reject-flow ${stamp}`
  );
  const { json: rejectTaxJson } = await api("/api/tax-applications", {
    method: "POST",
    body: JSON.stringify({
      journalEntryId: entryReject.id,
      taxType: "VDS",
      ratePercent: 5,
      baseAmount: 500,
    }),
  });
  const rejectTaxApplicationRow = rejectTaxJson.data as { id: string };

  const { res: rejectRes, json: rejectJson } = await api(
    `/api/tax-applications/${rejectTaxApplicationRow.id}/reject`,
    { method: "POST", body: JSON.stringify({ reason: "TEST: rejection reason" }) }
  );
  check("Reject succeeds", rejectRes.ok, `status=${rejectRes.status}`);
  check("Status is REJECTED", rejectJson.data?.status === "REJECTED", `status=${rejectJson.data?.status}`);
  check(
    "rejectionReason is persisted",
    rejectJson.data?.rejectionReason === "TEST: rejection reason",
    `rejectionReason=${rejectJson.data?.rejectionReason}`
  );

  const { res: rerejectRes } = await api(
    `/api/tax-applications/${rejectTaxApplicationRow.id}/reject`,
    { method: "POST" }
  );
  check(
    "Re-rejecting an already-REJECTED tax application is rejected with 409",
    rerejectRes.status === 409,
    `status=${rerejectRes.status}`
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
