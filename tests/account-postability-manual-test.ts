// Exercises account postability through the real API, including stale DRAFT
// fixtures that bypass the write guard, rendered account-picker options, and
// the normal postable-account reversal flow. Fixtures are removed afterward.
import "dotenv/config";

import { db } from "../src/lib/db";
import {
  createChartOfAccountSchema,
  updateChartOfAccountSchema,
} from "../src/modules/accounting/validations/chart-of-account.schema";

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

function hasRenderedOption(html: string, id: string): boolean {
  return [...html.matchAll(/<option\b([^>]*)>[\s\S]*?<\/option>/g)].some(
    ([, attributes]) => attributes.includes(`value="${id}"`)
  );
}

async function main() {
  console.log(`Testing against ${BASE_URL}\n`);
  const stamp = Date.now();
  const fixtureEntryIds: string[] = [];
  const fixtureAccountIds: string[] = [];

  try {
    const [branch, header, cash, revenue, operatingExpense] = await Promise.all([
      db.branch.findFirstOrThrow({ where: { isHeadOffice: true } }),
      db.chartOfAccount.findUniqueOrThrow({ where: { code: "1000" } }),
      db.chartOfAccount.findUniqueOrThrow({ where: { code: "1010" } }),
      db.chartOfAccount.findUniqueOrThrow({ where: { code: "4010" } }),
      db.chartOfAccount.findUniqueOrThrow({ where: { code: "5010" } }),
    ]);

    check("Header account 1000 is non-postable", !header.isPostable, `isPostable=${header.isPostable}`);
    check("Leaf account 5010 remains postable", operatingExpense.isPostable, `isPostable=${operatingExpense.isPostable}`);

    check(
      "Create schema rejects string boolean values",
      !createChartOfAccountSchema.safeParse({
        code: `TEST-ISPOSTABLE-STRICT-${stamp}`,
        name: "Strict Boolean",
        type: "ASSET",
        isPostable: "false",
      }).success,
      "isPostable must be a JSON boolean"
    );
    check(
      "Update schema rejects string boolean values",
      !updateChartOfAccountSchema.safeParse({ isPostable: "false" }).success,
      "isPostable must be a JSON boolean"
    );

    const createAccount = async (code: string, isPostable?: boolean) => {
      const { res, json } = await api("/api/accounts", {
        method: "POST",
        body: JSON.stringify({
          code,
          name: `TEST Account Postability ${code}`,
          type: "ASSET",
          ...(isPostable === undefined ? {} : { isPostable }),
        }),
      });
      check(
        `Create account ${code} persists its postability value`,
        res.status === 201 && json.data?.isPostable === (isPostable ?? true),
        `status=${res.status}, isPostable=${json.data?.isPostable}`
      );
      if (json.data?.id) fixtureAccountIds.push(json.data.id as string);
      return json.data as { id: string; isPostable: boolean } | undefined;
    };

    await createAccount(`TEST-ISPOSTABLE-DEFAULT-${stamp}`);
    await createAccount(`TEST-ISPOSTABLE-FALSE-${stamp}`, false);

    const journalBody = (accountId: string) => ({
      date: new Date().toISOString(),
      description: `TEST account postability ${stamp}`,
      branchId: branch.id,
      voucherType: "JOURNAL_VOUCHER",
      lines: [
        { accountId, branchId: branch.id, debit: 100, credit: 0 },
        { accountId: cash.id, branchId: branch.id, debit: 0, credit: 100 },
      ],
    });

    const { res: createBlockedRes, json: createBlockedJson } = await api("/api/journal-entries", {
      method: "POST",
      body: JSON.stringify(journalBody(header.id)),
    });
    check(
      "JournalEntry create rejects a non-postable account with 4xx",
      createBlockedRes.status === 400 &&
        typeof createBlockedJson.error === "string" &&
        createBlockedJson.error.includes("non-postable"),
      `status=${createBlockedRes.status}, error=${createBlockedJson.error}`
    );

    const createInvalidDraftFixture = async (suffix: string) => {
      const entry = await db.journalEntry.create({
        data: {
          date: new Date(),
          description: `TEST stale postability fixture ${suffix}`,
          branchId: branch.id,
          voucherType: "JOURNAL_VOUCHER",
          documentNumber: `TEST-ISPOSTABLE-${stamp}-${suffix}`,
          createdById: "system",
          lines: {
            create: [
              { accountId: header.id, branchId: branch.id, debit: 100, credit: 0 },
              { accountId: cash.id, branchId: branch.id, debit: 0, credit: 100 },
            ],
          },
        },
        include: { lines: true },
      });
      fixtureEntryIds.push(entry.id);
      return entry;
    };

    const updateFixture = await createInvalidDraftFixture("update");
    const originalUpdateLines = updateFixture.lines.map((line) => line.id).sort();
    const { res: updateBlockedRes, json: updateBlockedJson } = await api(
      `/api/journal-entries/${updateFixture.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          date: new Date().toISOString(),
          description: "TEST blocked update",
          lines: journalBody(header.id).lines,
        }),
      }
    );
    const afterRejectedUpdate = await db.journalLine.findMany({
      where: { journalEntryId: updateFixture.id },
      select: { id: true },
    });
    check(
      "JournalEntry update rejects a non-postable account with 4xx",
      updateBlockedRes.status === 400 &&
        typeof updateBlockedJson.error === "string" &&
        updateBlockedJson.error.includes("non-postable"),
      `status=${updateBlockedRes.status}, error=${updateBlockedJson.error}`
    );
    check(
      "Rejected update leaves the original lines intact",
      JSON.stringify(afterRejectedUpdate.map((line) => line.id).sort()) ===
        JSON.stringify(originalUpdateLines),
      `line IDs=${afterRejectedUpdate.map((line) => line.id).join(",")}`
    );

    const postFixture = await createInvalidDraftFixture("post");
    const { res: postBlockedRes, json: postBlockedJson } = await api(
      `/api/journal-entries/${postFixture.id}/post`,
      { method: "POST" }
    );
    const postFixtureAfter = await db.journalEntry.findUniqueOrThrow({
      where: { id: postFixture.id },
      select: { status: true },
    });
    check(
      "Posting a DRAFT with a non-postable account is rejected with 4xx",
      postBlockedRes.status === 400 &&
        typeof postBlockedJson.error === "string" &&
        postBlockedJson.error.includes("non-postable"),
      `status=${postBlockedRes.status}, error=${postBlockedJson.error}`
    );
    check(
      "Rejected post leaves the entry DRAFT",
      postFixtureAfter.status === "DRAFT",
      `status=${postFixtureAfter.status}`
    );

    const { res: debitVoucherRes, json: debitVoucherJson } = await api("/api/debit-vouchers", {
      method: "POST",
      body: JSON.stringify({
        date: new Date().toISOString(),
        description: `TEST debit voucher postability ${stamp}`,
        branchId: branch.id,
        cashBankAccountId: cash.id,
        lines: [{ expenseAccountId: header.id, amount: 100 }],
      }),
    });
    check(
      "Debit Voucher's direct-create path rejects a non-postable account",
      debitVoucherRes.status === 400 &&
        typeof debitVoucherJson.error === "string" &&
        debitVoucherJson.error.includes("non-postable"),
      `status=${debitVoucherRes.status}, error=${debitVoucherJson.error}`
    );

    const { res: validCreateRes, json: validCreateJson } = await api("/api/journal-entries", {
      method: "POST",
      body: JSON.stringify({
        ...journalBody(cash.id),
        description: `TEST rendered picker ${stamp}`,
        lines: [
          { accountId: cash.id, branchId: branch.id, debit: 100, credit: 0 },
          { accountId: revenue.id, branchId: branch.id, debit: 0, credit: 100 },
        ],
      }),
    });
    check("A valid postable JournalEntry can still be created", validCreateRes.status === 201, `status=${validCreateRes.status}`);
    const validDraft = validCreateJson.data as { id: string } | undefined;
    if (!validDraft?.id) {
      throw new Error(`Valid entry fixture creation failed: ${JSON.stringify(validCreateJson)}`);
    }
    fixtureEntryIds.push(validDraft.id);

    const editPageRes = await fetch(`${BASE_URL}/accounting/journal-entries/${validDraft.id}/edit`);
    const editPageHtml = await editPageRes.text();
    check("Edit page renders for the postable fixture", editPageRes.ok, `status=${editPageRes.status}`);
    check(
      "Rendered account picker includes a postable leaf account",
      hasRenderedOption(editPageHtml, cash.id),
      `expected the ${cash.code} account id in a rendered <option>`
    );
    check(
      "Rendered account picker omits non-postable header accounts",
      !hasRenderedOption(editPageHtml, header.id),
      `header ${header.code} absent from rendered <option> elements`
    );

    const reversalCreate = await api("/api/journal-entries", {
      method: "POST",
      body: JSON.stringify({
        ...journalBody(cash.id),
        description: `TEST normal reversal ${stamp}`,
        voucherType: "CASH_VOUCHER",
        lines: [
          { accountId: cash.id, branchId: branch.id, debit: 25, credit: 0 },
          { accountId: revenue.id, branchId: branch.id, debit: 0, credit: 25 },
        ],
      }),
    });
    if (reversalCreate.json.data?.id) fixtureEntryIds.push(reversalCreate.json.data.id as string);
    check("Normal postable-account entry is created for reversal regression", reversalCreate.res.status === 201, `status=${reversalCreate.res.status}`);
    const reversalOriginal = reversalCreate.json.data as { id: string } | undefined;
    if (!reversalOriginal?.id) {
      throw new Error(`Reversal fixture creation failed: ${JSON.stringify(reversalCreate.json)}`);
    }

    const { res: normalPostRes } = await api(
      `/api/journal-entries/${reversalOriginal.id}/post`,
      { method: "POST" }
    );
    check("Normal postable-account entry can be posted", normalPostRes.ok, `status=${normalPostRes.status}`);
    const { res: reverseRes, json: reverseJson } = await api(
      `/api/journal-entries/${reversalOriginal.id}/reverse`,
      { method: "POST", body: JSON.stringify({ reason: "TEST postability regression" }) }
    );
    if (reverseJson.data?.reversal?.id) {
      fixtureEntryIds.push(reverseJson.data.reversal.id as string);
    }
    check(
      "Reversal of a normal postable-account entry still succeeds",
      reverseRes.ok,
      `status=${reverseRes.status}`
    );

    console.log(`\n=== ${pass} passed, ${fail} failed ===`);
    if (fail > 0) process.exitCode = 1;
  } finally {
    await db.$transaction(async (tx) => {
      if (fixtureEntryIds.length > 0) {
        await tx.taxApplication.deleteMany({
          where: { journalEntryId: { in: fixtureEntryIds } },
        });
        await tx.journalEntry.deleteMany({
          where: { reversalOfEntryId: { in: fixtureEntryIds } },
        });
        await tx.journalEntry.deleteMany({ where: { id: { in: fixtureEntryIds } } });
      }
      if (fixtureAccountIds.length > 0) {
        await tx.chartOfAccount.deleteMany({ where: { id: { in: fixtureAccountIds } } });
      }
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
