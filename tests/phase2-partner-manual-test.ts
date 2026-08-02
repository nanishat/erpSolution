// Phase 2 (Partners & Tax Engine) manual test — Partner CRUD service/API layer.
//
// Exercises the real HTTP API surface: POST /api/partners, GET /api/partners,
// GET /api/partners/[id], PATCH /api/partners/[id], DELETE /api/partners/[id].
// Branches are read via GET /api/branches (no direct Prisma writes bypassing
// the service layer). Same conventions as the Phase 1 scripts: doesn't clean
// up after itself, safe to re-run. See tests/README.md.
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

  const { json: branchesJson } = await api("/api/branches");
  const branch = branchesJson.data[0] as { id: string; code: string };

  // --- 1. Create a CUSTOMER and a VENDOR successfully ---
  console.log("--- Create CUSTOMER and VENDOR ---");
  const { res: customerRes, json: customerJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "CUSTOMER",
      name: `TEST Customer ${stamp}`,
      tin: `TIN-CUST-${stamp}`,
      bin: `BIN-CUST-${stamp}`,
    }),
  });
  check("Create CUSTOMER succeeds", customerRes.status === 201, `status=${customerRes.status}`);
  check(
    "Created CUSTOMER has type CUSTOMER",
    customerJson.data?.type === "CUSTOMER",
    `type=${customerJson.data?.type}`
  );
  const customer = customerJson.data as { id: string; type: string };

  const { res: vendorRes, json: vendorJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "VENDOR",
      name: `TEST Vendor ${stamp}`,
      tin: `TIN-VEND-${stamp}`,
      bin: `BIN-VEND-${stamp}`,
      vatInclusiveInPrice: true,
    }),
  });
  check("Create VENDOR succeeds", vendorRes.status === 201, `status=${vendorRes.status}`);
  check(
    "Created VENDOR has type VENDOR",
    vendorJson.data?.type === "VENDOR",
    `type=${vendorJson.data?.type}`
  );
  const vendor = vendorJson.data as { id: string; type: string };

  // --- 2. Creating a partner without TIN or BIN is rejected ---
  console.log("\n--- Missing TIN/BIN rejected ---");
  const { res: noTinRes, json: noTinJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "CUSTOMER",
      name: `TEST No TIN ${stamp}`,
      bin: `BIN-NOTIN-${stamp}`,
    }),
  });
  check(
    "Create without TIN is rejected with 400",
    noTinRes.status === 400,
    `status=${noTinRes.status} body=${JSON.stringify(noTinJson)}`
  );

  const { res: noBinRes, json: noBinJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "CUSTOMER",
      name: `TEST No BIN ${stamp}`,
      tin: `TIN-NOBIN-${stamp}`,
    }),
  });
  check(
    "Create without BIN is rejected with 400",
    noBinRes.status === 400,
    `status=${noBinRes.status} body=${JSON.stringify(noBinJson)}`
  );

  // --- 3. Attempting to change type via PATCH is rejected ---
  console.log("\n--- Type change via PATCH rejected ---");
  const { res: typeChangeRes, json: typeChangeJson } = await api(`/api/partners/${customer.id}`, {
    method: "PATCH",
    body: JSON.stringify({ type: "VENDOR" }),
  });
  check(
    "Changing type via PATCH is rejected with 409",
    typeChangeRes.status === 409,
    `status=${typeChangeRes.status} body=${JSON.stringify(typeChangeJson)}`
  );
  const { json: customerAfterJson } = await api(`/api/partners/${customer.id}`);
  check(
    "Partner's type is unchanged after the rejected attempt",
    customerAfterJson.data.type === "CUSTOMER",
    `type=${customerAfterJson.data.type}`
  );

  // A same-value "change" (type equal to current type) should be a no-op, not rejected.
  const { res: sameTypeRes } = await api(`/api/partners/${customer.id}`, {
    method: "PATCH",
    body: JSON.stringify({ type: "CUSTOMER", contactPerson: "Same-type PATCH check" }),
  });
  check(
    "PATCH with type equal to the current type is not rejected",
    sameTypeRes.ok,
    `status=${sameTypeRes.status}`
  );

  // --- 4. Deactivating a partner ---
  console.log("\n--- Deactivate excludes from default list, still fetchable by id ---");
  const { res: deactivateRes, json: deactivateJson } = await api(`/api/partners/${vendor.id}`, {
    method: "DELETE",
  });
  check("Deactivate succeeds", deactivateRes.ok, `status=${deactivateRes.status}`);
  check(
    "Deactivated partner has isActive=false",
    deactivateJson.data?.isActive === false,
    `isActive=${deactivateJson.data?.isActive}`
  );

  const { json: defaultListJson } = await api("/api/partners");
  const inDefaultList = (defaultListJson.data as Array<{ id: string }>).some(
    (p) => p.id === vendor.id
  );
  check(
    "Deactivated partner is excluded from default list results",
    !inDefaultList,
    `found in default list=${inDefaultList}`
  );

  const { res: fetchByIdRes, json: fetchByIdJson } = await api(`/api/partners/${vendor.id}`);
  check(
    "Deactivated partner is still fetchable by id",
    fetchByIdRes.ok && fetchByIdJson.data?.id === vendor.id,
    `status=${fetchByIdRes.status}`
  );

  const { json: inactiveListJson } = await api("/api/partners?isActive=false");
  const inInactiveList = (inactiveListJson.data as Array<{ id: string }>).some(
    (p) => p.id === vendor.id
  );
  check(
    "Deactivated partner appears when isActive=false is explicitly requested",
    inInactiveList,
    `found=${inInactiveList}`
  );

  // --- 5. localBranchId validation ---
  console.log("\n--- localBranchId validation ---");
  const { res: validBranchRes, json: validBranchJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "VENDOR",
      name: `TEST Local Vendor ${stamp}`,
      tin: `TIN-LOCAL-${stamp}`,
      bin: `BIN-LOCAL-${stamp}`,
      localBranchId: branch.id,
    }),
  });
  check(
    "Create with a valid localBranchId succeeds",
    validBranchRes.status === 201,
    `status=${validBranchRes.status}`
  );
  check(
    "Created partner has the given localBranchId",
    validBranchJson.data?.localBranchId === branch.id,
    `localBranchId=${validBranchJson.data?.localBranchId}`
  );

  const { res: invalidBranchRes, json: invalidBranchJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "VENDOR",
      name: `TEST Bad Branch Vendor ${stamp}`,
      tin: `TIN-BADBRANCH-${stamp}`,
      bin: `BIN-BADBRANCH-${stamp}`,
      localBranchId: "nonexistent-branch-id",
    }),
  });
  check(
    "Create with a nonexistent localBranchId is rejected with 400",
    invalidBranchRes.status === 400,
    `status=${invalidBranchRes.status} body=${JSON.stringify(invalidBranchJson)}`
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
