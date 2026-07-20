import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const assets = await prisma.account.create({
    data: { code: "1000", name: "Assets", type: "ASSET", isSystem: true },
  });
  const liabilities = await prisma.account.create({
    data: { code: "2000", name: "Liabilities", type: "LIABILITY", isSystem: true },
  });
  await prisma.account.create({
    data: { code: "3000", name: "Equity", type: "EQUITY", isSystem: true },
  });
  const revenue = await prisma.account.create({
    data: { code: "4000", name: "Revenue", type: "REVENUE", isSystem: true },
  });
  const expense = await prisma.account.create({
    data: { code: "5000", name: "Expense", type: "EXPENSE", isSystem: true },
  });

  await prisma.account.createMany({
    data: [
      {
        code: "1010",
        name: "Cash",
        type: "ASSET",
        subType: "CASH",
        parentId: assets.id,
        isReconcilable: true,
      },
      {
        code: "1020",
        name: "Bank",
        type: "ASSET",
        subType: "BANK",
        parentId: assets.id,
        isReconcilable: true,
      },
      {
        code: "1200",
        name: "Accounts Receivable",
        type: "ASSET",
        subType: "RECEIVABLE",
        parentId: assets.id,
      },
      {
        code: "2100",
        name: "Accounts Payable",
        type: "LIABILITY",
        subType: "PAYABLE",
        parentId: liabilities.id,
      },
      {
        code: "4010",
        name: "Sales Revenue",
        type: "REVENUE",
        subType: "OPERATING_REVENUE",
        parentId: revenue.id,
      },
      {
        code: "5010",
        name: "Operating Expenses",
        type: "EXPENSE",
        subType: "OPERATING_EXPENSE",
        parentId: expense.id,
      },
    ],
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
