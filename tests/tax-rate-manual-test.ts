// TaxRate CRUD service/API layer manual test — fills the gap flagged in
// phase2-tax-application-manual-test.ts ("no admin CRUD API for TaxRate yet").
//
// Exercises the real HTTP API surface: POST /api/tax-rates, GET /api/tax-rates,
// GET /api/tax-rates/[id], PATCH /api/tax-rates/[id], DELETE /api/tax-rates/[id]
// (soft delete via isActive). No direct Prisma writes bypassing the service
// layer. Same conventions as the other manual scripts: doesn't clean up after
// itself, safe to re-run, uses `TEST ... <timestamp>` naming. See tests/README.md.
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

  // --- 1. Create a tax rate ---
  console.log("--- Create ---");
  const { res: createRes, json: createJson } = await api("/api/tax-rates", {
    method: "POST",
    body: JSON.stringify({
      type: "VAT",
      category: "Standard",
      name: `TEST Standard VAT 15% ${stamp}`,
      ratePercent: 15,
      direction: "OUTPUT",
    }),
  });
  check("Create succeeds", createRes.status === 201, `status=${createRes.status} body=${JSON.stringify(createJson)}`);
  check(
    "Created rate has the given ratePercent",
    Number(createJson.data?.ratePercent) === 15,
    `ratePercent=${createJson.data?.ratePercent}`
  );
  check(
    "computationType defaults to EXCLUSIVE",
    createJson.data?.computationType === "EXCLUSIVE",
    `computationType=${createJson.data?.computationType}`
  );
  check("New rate starts active", createJson.data?.isActive === true, `isActive=${createJson.data?.isActive}`);
  const rate = createJson.data as { id: string };

  // --- 2. ratePercent range validation (0-15, fractional allowed) ---
  console.log("\n--- ratePercent validation ---");
  const { res: fractionalRes, json: fractionalJson } = await api("/api/tax-rates", {
    method: "POST",
    body: JSON.stringify({
      type: "VAT",
      category: "Reduced",
      name: `TEST Fractional VAT ${stamp}`,
      ratePercent: 7.5,
      direction: "INPUT",
    }),
  });
  check(
    "Fractional ratePercent (7.5) is accepted",
    fractionalRes.status === 201 && Number(fractionalJson.data?.ratePercent) === 7.5,
    `status=${fractionalRes.status} ratePercent=${fractionalJson.data?.ratePercent}`
  );

  const { res: tooHighRes } = await api("/api/tax-rates", {
    method: "POST",
    body: JSON.stringify({
      type: "VAT",
      category: "Invalid",
      name: `TEST Too High VAT ${stamp}`,
      ratePercent: 15.01,
      direction: "OUTPUT",
    }),
  });
  check("ratePercent above 15 is rejected with 400", tooHighRes.status === 400, `status=${tooHighRes.status}`);

  const { res: negativeRes } = await api("/api/tax-rates", {
    method: "POST",
    body: JSON.stringify({
      type: "VAT",
      category: "Invalid",
      name: `TEST Negative VAT ${stamp}`,
      ratePercent: -1,
      direction: "OUTPUT",
    }),
  });
  check("Negative ratePercent is rejected with 400", negativeRes.status === 400, `status=${negativeRes.status}`);

  // --- 3. List includes the created rate ---
  console.log("\n--- List ---");
  const { json: listJson } = await api("/api/tax-rates");
  const inList = (listJson.data as Array<{ id: string }>).some((r) => r.id === rate.id);
  check("Created rate appears in the default list", inList, `found=${inList}`);

  // --- 4. Update ---
  console.log("\n--- Update ---");
  const { res: updateRes, json: updateJson } = await api(`/api/tax-rates/${rate.id}`, {
    method: "PATCH",
    body: JSON.stringify({ name: `TEST Standard VAT 15% (renamed) ${stamp}` }),
  });
  check("Update succeeds", updateRes.ok, `status=${updateRes.status}`);
  check(
    "Update persisted the new name",
    updateJson.data?.name === `TEST Standard VAT 15% (renamed) ${stamp}`,
    `name=${updateJson.data?.name}`
  );

  const { res: updateMissingRes } = await api("/api/tax-rates/nonexistent-id", {
    method: "PATCH",
    body: JSON.stringify({ name: "TEST should 404" }),
  });
  check(
    "Updating a nonexistent tax rate is rejected with 404",
    updateMissingRes.status === 404,
    `status=${updateMissingRes.status}`
  );

  // --- 5. Deactivate excludes from default list, still fetchable by id ---
  console.log("\n--- Deactivate excludes from default list, still fetchable by id ---");
  const { res: deactivateRes, json: deactivateJson } = await api(`/api/tax-rates/${rate.id}`, {
    method: "DELETE",
  });
  check("Deactivate succeeds", deactivateRes.ok, `status=${deactivateRes.status}`);
  check(
    "Deactivated rate has isActive=false",
    deactivateJson.data?.isActive === false,
    `isActive=${deactivateJson.data?.isActive}`
  );

  const { json: defaultListAfterJson } = await api("/api/tax-rates");
  const inDefaultListAfter = (defaultListAfterJson.data as Array<{ id: string }>).some(
    (r) => r.id === rate.id
  );
  check(
    "Deactivated rate is excluded from default list results",
    !inDefaultListAfter,
    `found in default list=${inDefaultListAfter}`
  );

  const { res: fetchByIdRes, json: fetchByIdJson } = await api(`/api/tax-rates/${rate.id}`);
  check(
    "Deactivated rate is still fetchable by id",
    fetchByIdRes.ok && fetchByIdJson.data?.id === rate.id,
    `status=${fetchByIdRes.status}`
  );

  const { json: inactiveListJson } = await api("/api/tax-rates?isActive=false");
  const inInactiveList = (inactiveListJson.data as Array<{ id: string }>).some(
    (r) => r.id === rate.id
  );
  check(
    "Deactivated rate appears when isActive=false is explicitly requested",
    inInactiveList,
    `found=${inInactiveList}`
  );

  const { res: deactivateMissingRes } = await api("/api/tax-rates/nonexistent-id", {
    method: "DELETE",
  });
  check(
    "Deactivating a nonexistent tax rate is rejected with 404",
    deactivateMissingRes.status === 404,
    `status=${deactivateMissingRes.status}`
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
