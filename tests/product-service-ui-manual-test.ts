// ProductService UI (list + create/edit forms) manual test — pages live
// under /accounting/product-services, on top of the CRUD API covered by
// product-service-manual-test.ts.
//
// There's no headless-browser/JSDOM runner wired up (see tests/README.md),
// so this fetches the server-rendered HTML and asserts on markup rather
// than driving a real browser, same as phase2-partner-ui-manual-test.ts.
// ProductServiceTable is a client component that receives the full,
// unfiltered list as a prop, and Next.js also embeds that as a serialized
// RSC payload elsewhere in the same document for hydration — a plain
// substring search for a created row's code would match even before it's
// actually visible in the table. `appearsRendered` checks for the rendered
// anchor text (`>value<`) instead, which only appears in the real
// server-rendered DOM.
//
// Same conventions as the other manual scripts: doesn't clean up after
// itself, safe to re-run, uses `TEST ... <timestamp>` naming.
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

// Matches the actual rendered anchor/cell text (`>value<`), not the
// JSON-escaped RSC hydration payload also present in the document.
function appearsRendered(html: string, text: string): boolean {
  return html.includes(`>${text}<`);
}

async function main() {
  console.log(`Testing against ${BASE_URL}\n`);
  const stamp = Date.now();

  // --- Fixture: a real income account ---
  const { res: incomeRes, json: incomeJson } = await api("/api/accounts", {
    method: "POST",
    body: JSON.stringify({
      code: `TEST-PSUI-INC-${stamp}`,
      name: `TEST UI Income Account ${stamp}`,
      type: "REVENUE",
      subType: "OTHER_REVENUE",
    }),
  });
  if (!incomeRes.ok) {
    throw new Error(`Failed to create income account fixture: ${JSON.stringify(incomeJson)}`);
  }
  const incomeAccount = incomeJson.data as { id: string };

  // --- 1. List page renders ---
  console.log("--- List page renders ---");
  const { res: listRes, html: listHtmlBefore } = await page("/accounting/product-services");
  check("GET /accounting/product-services succeeds", listRes.ok, `status=${listRes.status}`);
  check(
    "List page has the Products & services heading",
    listHtmlBefore.includes(">Products &amp; services<") ||
      listHtmlBefore.includes(">Products & services<"),
    "heading present"
  );
  check(
    "List page has a New product/service link",
    listHtmlBefore.includes("New product/service"),
    "link present"
  );

  // --- 2. New product/service form renders with expected fields ---
  console.log("\n--- New product/service form renders ---");
  const { res: newRes, html: newHtml } = await page("/accounting/product-services/new");
  check("GET /accounting/product-services/new succeeds", newRes.ok, `status=${newRes.status}`);
  for (const field of [
    "code",
    "name",
    "type",
    "unitPrice",
    "unit",
    "incomeAccountId",
    "expenseAccountId",
  ]) {
    check(
      `Create form has a "${field}" field`,
      newHtml.includes(`name="${field}"`),
      `name="${field}" present`
    );
  }

  // --- 3. Create flow end-to-end: submit -> appears in list ---
  console.log("\n--- Create flow: submit -> appears in list ---");
  const code = `TEST-PSUI-${stamp}`;
  const { res: createRes, json: createJson } = await api("/api/product-services", {
    method: "POST",
    body: JSON.stringify({
      code,
      name: `TEST UI Product ${stamp}`,
      type: "PRODUCT",
      unitPrice: 99.99,
      incomeAccountId: incomeAccount.id,
    }),
  });
  check("Create via the form's endpoint succeeds", createRes.status === 201, `status=${createRes.status}`);
  const created = createJson.data as { id: string; code: string };

  const { html: listHtmlAfter } = await page("/accounting/product-services");
  check(
    "Newly created row's code appears rendered on the list page",
    appearsRendered(listHtmlAfter, code),
    `looked for rendered ">${code}<"`
  );

  // --- 4. Edit form: existing values populate the form ---
  console.log("\n--- Edit form populates existing values ---");
  const { res: editRes, html: editHtml } = await page(
    `/accounting/product-services/${created.id}/edit`
  );
  check("GET /accounting/product-services/[id]/edit succeeds", editRes.ok, `status=${editRes.status}`);
  check(
    "Edit page's subtitle shows the row's current code",
    editHtml.includes(code),
    `looked for "${code}"`
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
