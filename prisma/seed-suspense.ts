// Adds the Suspense Account called out as a business requirement (holds
// loan-related or anonymous/unclassified transactions until they're properly
// categorized) but never actually seeded. Safe to run more than once.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const SUSPENSE_CODE = "1900";
const SUSPENSE_NAME = "Suspense Account";

async function main() {
  const existing = await prisma.chartOfAccount.findFirst({
    where: {
      OR: [{ code: SUSPENSE_CODE }, { name: { equals: SUSPENSE_NAME, mode: "insensitive" } }],
    },
  });

  if (existing) {
    console.log(
      `Suspense Account already exists (code ${existing.code}, id ${existing.id}) — skipping.`
    );
    return;
  }

  const expense = await prisma.chartOfAccount.findUnique({ where: { code: "5000" } });
  if (!expense) {
    throw new Error('Expense header account (code "5000") not found — run seed-coa.ts first.');
  }

  // EXPENSE/OTHER_EXPENSE, not ASSET — see the reclassification note in
  // migration 20260903100000_seed_head_of_expense_accounts. Unusual for a
  // clearing account, but explicit/confirmed, not inferred.
  const suspense = await prisma.chartOfAccount.create({
    data: {
      code: SUSPENSE_CODE,
      name: SUSPENSE_NAME,
      description:
        "Holds loan-related or anonymous/unclassified transactions until they are properly categorized.",
      type: "EXPENSE",
      subType: "OTHER_EXPENSE",
      parentId: expense.id,
      isSystem: true,
      isActive: true,
    },
  });

  console.log(`Created Suspense Account: code ${suspense.code}, id ${suspense.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
