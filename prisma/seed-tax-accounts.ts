// Adds the ChartOfAccount rows required for tax posting (see
// tax-posting.service.ts): VAT Payable/Receivable and TDS/VDS Payable.
// Follows the same idempotent, skip-if-exists convention as
// seed-suspense.ts — safe to run more than once.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const TAX_ACCOUNTS = [
  {
    code: "2110",
    name: "VAT Payable",
    description: "Output VAT collected on sales, owed to the tax authority.",
    type: "LIABILITY" as const,
    subType: "PAYABLE" as const,
    parentCode: "2000",
  },
  {
    code: "1210",
    name: "VAT Receivable",
    description: "Input VAT paid on purchases, reclaimable from the tax authority.",
    type: "ASSET" as const,
    subType: "RECEIVABLE" as const,
    parentCode: "1000",
  },
  {
    code: "2120",
    name: "TDS Payable",
    description: "Tax deducted at source from vendor payments, owed to the tax authority.",
    type: "LIABILITY" as const,
    subType: "PAYABLE" as const,
    parentCode: "2000",
  },
  {
    code: "2130",
    name: "VDS Payable",
    description: "VAT deducted at source from vendor payments, owed to the tax authority.",
    type: "LIABILITY" as const,
    subType: "PAYABLE" as const,
    parentCode: "2000",
  },
];

async function main() {
  for (const account of TAX_ACCOUNTS) {
    const existing = await prisma.chartOfAccount.findFirst({
      where: {
        OR: [{ code: account.code }, { name: { equals: account.name, mode: "insensitive" } }],
      },
    });
    if (existing) {
      console.log(`${account.name} already exists (code ${existing.code}, id ${existing.id}) — skipping.`);
      continue;
    }

    const parent = await prisma.chartOfAccount.findUnique({ where: { code: account.parentCode } });
    if (!parent) {
      throw new Error(`Parent account (code "${account.parentCode}") not found — run seed-coa.ts first.`);
    }

    const created = await prisma.chartOfAccount.create({
      data: {
        code: account.code,
        name: account.name,
        description: account.description,
        type: account.type,
        subType: account.subType,
        parentId: parent.id,
        isSystem: true,
        isActive: true,
      },
    });

    console.log(`Created ${created.name}: code ${created.code}, id ${created.id}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
