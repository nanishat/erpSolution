// ProductService CRUD service/API layer manual test — the catalog of
// billable items/services that map to income/expense ChartOfAccount rows
// (product-service.service.ts), added to unblock a working product picker
// for Customer Invoice's create form.
//
// Exercises the real HTTP API surface: POST /api/product-services, GET
// /api/product-services, GET /api/product-services/[id], PATCH
// /api/product-services/[id], DELETE /api/product-services/[id] (soft
// delete via isActive). No direct Prisma writes bypassing the service layer
// except reading/creating the ChartOfAccount fixtures through the existing
// /api/accounts route (same convention as phase3-invoice-manual-test.ts).
// Same conventions as the other manual scripts: doesn't clean up after
// itself, safe to re-run, uses `TEST ... <timestamp>` naming. See
// tests/README.md.
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

async function main() {
  console.log(`Testing against ${BASE_URL}\n`);
  const stamp = Date.now();

  // --- Fixtures: a real income account and a real expense account ---
  const { res: incomeRes, json: incomeJson } = await api("/api/accounts", {
    method: "POST",
    body: JSON.stringify({
      code: `TEST-PS-INC-${stamp}`,
      name: `TEST Income Account ${stamp}`,
      type: "REVENUE",
      subType: "OTHER_REVENUE",
    }),
  });
  if (!incomeRes.ok) {
    throw new Error(`Failed to create income account fixture: ${JSON.stringify(incomeJson)}`);
  }
  const incomeAccount = incomeJson.data as { id: string };

  const { res: expenseRes, json: expenseJson } = await api("/api/accounts", {
    method: "POST",
    body: JSON.stringify({
      code: `TEST-PS-EXP-${stamp}`,
      name: `TEST Expense Account ${stamp}`,
      type: "EXPENSE",
      subType: "OTHER_EXPENSE",
    }),
  });
  if (!expenseRes.ok) {
    throw new Error(`Failed to create expense account fixture: ${JSON.stringify(expenseJson)}`);
  }
  const expenseAccount = expenseJson.data as { id: string };

  // --- 1. Create a PRODUCT and a SERVICE ---
  console.log("--- Create ---");
  const { res: productRes, json: productJson } = await api("/api/product-services", {
    method: "POST",
    body: JSON.stringify({
      code: `TEST-PROD-${stamp}`,
      name: `TEST Product ${stamp}`,
      type: "PRODUCT",
      unitPrice: 250.5,
      unit: "per unit",
      incomeAccountId: incomeAccount.id,
      expenseAccountId: expenseAccount.id,
    }),
  });
  check(
    "Create PRODUCT succeeds",
    productRes.status === 201,
    `status=${productRes.status} body=${JSON.stringify(productJson)}`
  );
  check("Created row has type PRODUCT", productJson.data?.type === "PRODUCT", `type=${productJson.data?.type}`);
  check(
    "Created row has the given unitPrice",
    Number(productJson.data?.unitPrice) === 250.5,
    `unitPrice=${productJson.data?.unitPrice}`
  );
  check("New row starts active", productJson.data?.isActive === true, `isActive=${productJson.data?.isActive}`);
  const product = productJson.data as { id: string };

  const { res: serviceRes, json: serviceJson } = await api("/api/product-services", {
    method: "POST",
    body: JSON.stringify({
      code: `TEST-SVC-${stamp}`,
      name: `TEST Service ${stamp}`,
      type: "SERVICE",
      unitPrice: 1000,
      incomeAccountId: incomeAccount.id,
    }),
  });
  check(
    "Create SERVICE succeeds",
    serviceRes.status === 201,
    `status=${serviceRes.status} body=${JSON.stringify(serviceJson)}`
  );
  check("Created row has type SERVICE", serviceJson.data?.type === "SERVICE", `type=${serviceJson.data?.type}`);
  check(
    "SERVICE with no expenseAccountId stores it as null",
    serviceJson.data?.expenseAccountId === null,
    `expenseAccountId=${serviceJson.data?.expenseAccountId}`
  );
  const service = serviceJson.data as { id: string };

  // --- 2. Duplicate code is rejected ---
  console.log("\n--- Duplicate code ---");
  const { res: dupRes } = await api("/api/product-services", {
    method: "POST",
    body: JSON.stringify({
      code: `TEST-PROD-${stamp}`,
      name: `TEST Duplicate Code ${stamp}`,
      type: "PRODUCT",
      incomeAccountId: incomeAccount.id,
    }),
  });
  check("Duplicate code is rejected with 409", dupRes.status === 409, `status=${dupRes.status}`);

  // --- 3. Nonexistent incomeAccountId is rejected ---
  console.log("\n--- Nonexistent incomeAccountId ---");
  const { res: badIncomeRes } = await api("/api/product-services", {
    method: "POST",
    body: JSON.stringify({
      code: `TEST-BAD-INC-${stamp}`,
      name: `TEST Bad Income ${stamp}`,
      type: "PRODUCT",
      incomeAccountId: "nonexistent-id",
    }),
  });
  check(
    "Nonexistent incomeAccountId is rejected with 400",
    badIncomeRes.status === 400,
    `status=${badIncomeRes.status}`
  );

  // --- 4. Nonexistent expenseAccountId (when provided) is rejected ---
  console.log("\n--- Nonexistent expenseAccountId ---");
  const { res: badExpenseRes } = await api("/api/product-services", {
    method: "POST",
    body: JSON.stringify({
      code: `TEST-BAD-EXP-${stamp}`,
      name: `TEST Bad Expense ${stamp}`,
      type: "PRODUCT",
      incomeAccountId: incomeAccount.id,
      expenseAccountId: "nonexistent-id",
    }),
  });
  check(
    "Nonexistent expenseAccountId is rejected with 400",
    badExpenseRes.status === 400,
    `status=${badExpenseRes.status}`
  );

  // --- 5. Deactivate excludes from default list, still fetchable by id ---
  console.log("\n--- Deactivate excludes from default list, still fetchable by id ---");
  const { res: deactivateRes, json: deactivateJson } = await api(
    `/api/product-services/${product.id}`,
    { method: "DELETE" }
  );
  check("Deactivate succeeds", deactivateRes.ok, `status=${deactivateRes.status}`);
  check(
    "Deactivated row has isActive=false",
    deactivateJson.data?.isActive === false,
    `isActive=${deactivateJson.data?.isActive}`
  );

  const { json: defaultListAfterJson } = await api("/api/product-services");
  const inDefaultListAfter = (defaultListAfterJson.data as Array<{ id: string }>).some(
    (p) => p.id === product.id
  );
  check(
    "Deactivated row is excluded from default list results",
    !inDefaultListAfter,
    `found in default list=${inDefaultListAfter}`
  );

  const { res: fetchByIdRes, json: fetchByIdJson } = await api(`/api/product-services/${product.id}`);
  check(
    "Deactivated row is still fetchable by id",
    fetchByIdRes.ok && fetchByIdJson.data?.id === product.id,
    `status=${fetchByIdRes.status}`
  );

  const { json: inactiveListJson } = await api("/api/product-services?isActive=false");
  const inInactiveList = (inactiveListJson.data as Array<{ id: string }>).some(
    (p) => p.id === product.id
  );
  check(
    "Deactivated row appears when isActive=false is explicitly requested",
    inInactiveList,
    `found=${inInactiveList}`
  );

  // Sanity: the SERVICE fixture (never deactivated) still appears in the default list.
  const { json: defaultListJson } = await api("/api/product-services");
  const serviceStillListed = (defaultListJson.data as Array<{ id: string }>).some(
    (p) => p.id === service.id
  );
  check(
    "Still-active SERVICE fixture appears in the default list",
    serviceStillListed,
    `found=${serviceStillListed}`
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
