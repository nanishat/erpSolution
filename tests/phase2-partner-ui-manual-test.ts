// Phase 2 (Partners & Tax Engine) manual test — Partner UI (list + create/edit
// forms) added on top of the CRUD API covered by phase2-partner-manual-test.ts.
// Pages live under /accounting/partners (nested, not top-level — see the nav
// restructure that grouped all accounting-domain pages under /accounting).
//
// There's no headless-browser/JSDOM runner wired up (see tests/README.md), so
// this exercises the App Router pages the same way phase1-followup-fixes-test.ts
// checks the journal entry detail page: fetch the server-rendered HTML and
// assert on markup, rather than driving a real browser. Partner creation goes
// through the real POST /api/partners endpoint (already covered end-to-end by
// phase2-partner-manual-test.ts) since that's exactly what PartnerForm's
// onSubmit does under the hood.
//
// Same conventions as the other Phase 1/2 scripts: doesn't clean up after
// itself, safe to re-run, uses a `TEST ... <timestamp>` name/TIN/BIN.
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

// Pulls out a single tag (e.g. `<select ... name="type" ...>`) so we can check
// its attributes (like `disabled`) without a full HTML parser.
function extractTag(html: string, tagName: string, attrMatch: string): string | null {
  const re = new RegExp(`<${tagName}[^>]*${attrMatch}[^>]*>`);
  return re.exec(html)?.[0] ?? null;
}

// Matches the `disabled` HTML attribute itself (React SSR renders it as
// `disabled=""`) — not the Tailwind `disabled:` variant classes that also
// appear in these tags' `class` attribute.
function hasDisabledAttr(tag: string): boolean {
  return /\sdisabled(=""|[\s>])/.test(tag);
}

async function main() {
  console.log(`Testing against ${BASE_URL}\n`);
  const stamp = Date.now();

  // --- 1. List page renders ---
  console.log("--- List page renders ---");
  const { res: listRes, html: listHtmlBefore } = await page("/accounting/partners");
  check("GET /accounting/partners succeeds", listRes.ok, `status=${listRes.status}`);
  check(
    "List page has the Partners heading",
    listHtmlBefore.includes(">Partners<"),
    "heading present"
  );
  check(
    "List page has a New partner link",
    listHtmlBefore.includes("New partner"),
    "link present"
  );

  // --- 2. New partner form renders with expected fields, type not locked ---
  console.log("\n--- New partner form renders ---");
  const { res: newRes, html: newHtml } = await page("/accounting/partners/new");
  check("GET /accounting/partners/new succeeds", newRes.ok, `status=${newRes.status}`);
  for (const field of ["type", "name", "tin", "bin", "localBranchId"]) {
    check(
      `Create form has a "${field}" field`,
      newHtml.includes(`name="${field}"`),
      `name="${field}" present`
    );
  }
  const createTypeTag = extractTag(newHtml, "select", 'name="type"');
  check(
    "Create form's type select is NOT disabled",
    createTypeTag !== null && !hasDisabledAttr(createTypeTag),
    `tag=${createTypeTag}`
  );

  // --- 3. Create flow end-to-end: submit -> appears in list ---
  console.log("\n--- Create flow: submit -> appears in list ---");
  const partnerName = `TEST UI Partner ${stamp}`;
  const { res: createRes, json: createJson } = await api("/api/partners", {
    method: "POST",
    body: JSON.stringify({
      type: "CUSTOMER",
      name: partnerName,
      tin: `TIN-UI-${stamp}`,
      bin: `BIN-UI-${stamp}`,
    }),
  });
  check("Create via the form's endpoint succeeds", createRes.status === 201, `status=${createRes.status}`);
  const created = createJson.data as { id: string; name: string };

  const { html: listHtmlAfter } = await page("/accounting/partners");
  check(
    "Newly created partner's name appears on the list page",
    listHtmlAfter.includes(partnerName),
    `looked for "${partnerName}"`
  );

  // --- 4. Edit form: type field is locked, existing values populate the form ---
  console.log("\n--- Edit form locks the type field ---");
  const { res: editRes, html: editHtml } = await page(`/accounting/partners/${created.id}/edit`);
  check("GET /accounting/partners/[id]/edit succeeds", editRes.ok, `status=${editRes.status}`);
  check(
    "Edit page's subtitle shows the partner's current name",
    editHtml.includes(partnerName),
    `looked for "${partnerName}"`
  );
  const editTypeTag = extractTag(editHtml, "select", 'name="type"');
  check(
    "Edit form's type select IS disabled",
    editTypeTag !== null && hasDisabledAttr(editTypeTag),
    `tag=${editTypeTag}`
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
