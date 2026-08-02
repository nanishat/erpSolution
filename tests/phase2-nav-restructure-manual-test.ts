// Phase 2 (Partners & Tax Engine) manual test — sidebar nav restructure that
// grouped accounting-domain pages (Journal Entries, Chart of Accounts, Trial
// Balance, Partners) under a single collapsible "Accounting" section instead
// of Partners sitting as a flat top-level sibling of Accounting/HR/Inventory.
//
// Partners' page routes moved from /partners to /accounting/partners as part
// of this (see DashboardShell.tsx and tests/README.md for why). This script
// checks the new nested links all resolve, the old top-level /partners routes
// are gone, and the DashboardShell sidebar (rendered on every dashboard page)
// no longer has a top-level Partners link.
//
// There's no headless browser/JSDOM runner set up (see tests/README.md), so
// this fetches server-rendered page HTML directly and asserts on markup,
// same approach as phase2-partner-ui-manual-test.ts.
import "dotenv/config";

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

async function page(path: string) {
  const res = await fetch(`${BASE_URL}${path}`);
  const html = await res.text();
  return { res, html };
}

async function main() {
  console.log(`Testing against ${BASE_URL}\n`);

  // --- 1. Every nav link resolves (200, not 404) ---
  console.log("--- Nav links resolve ---");
  const navLinks = [
    "/accounting",
    "/accounting/chart-of-accounts",
    "/accounting/reports/trial-balance",
    "/accounting/partners",
    "/hr",
    "/inventory",
  ];
  for (const link of navLinks) {
    const { res } = await page(link);
    check(`${link} resolves`, res.status === 200, `status=${res.status}`);
  }

  // --- 2. Old top-level /partners routes are gone ---
  console.log("\n--- Old top-level /partners routes removed ---");
  for (const link of ["/partners", "/partners/new"]) {
    const { res } = await page(link);
    check(`${link} is a 404`, res.status === 404, `status=${res.status}`);
  }

  // --- 3. Sidebar structure: Partners nested under Accounting, not top-level ---
  console.log("\n--- Sidebar groups Partners under Accounting ---");
  const { html } = await page("/accounting");
  check(
    "Sidebar has a nested link to /accounting/partners",
    html.includes('href="/accounting/partners"'),
    "nested Partners link present"
  );
  check(
    "Sidebar has no top-level /partners link",
    !html.includes('href="/partners"'),
    "no bare /partners href present"
  );
  check(
    "Sidebar still has the Accounting group label",
    html.includes(">Accounting<") || html.includes("Accounting</"),
    "Accounting label present"
  );
  check(
    "Sidebar still links to HR and Inventory as top-level items",
    html.includes('href="/hr"') && html.includes('href="/inventory"'),
    "HR and Inventory links present"
  );

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
