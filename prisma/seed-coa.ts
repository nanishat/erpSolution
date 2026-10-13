import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type AccountSubType, type AccountType } from "@prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type AccountSeed = {
  code: string;
  name: string;
  type: AccountType;
  subType?: AccountSubType;
  parentId?: string;
  isSystem?: boolean;
  isReconcilable?: boolean;
  isPostable?: boolean;
};

async function upsertAccount(account: AccountSeed) {
  const { code, ...data } = account;
  return prisma.chartOfAccount.upsert({
    where: { code },
    create: account,
    update: data,
  });
}

async function main() {
  const assets = await upsertAccount({
    code: "1000",
    name: "Assets",
    type: "ASSET",
    isSystem: true,
    isPostable: false,
  });
  const liabilities = await upsertAccount({
    code: "2000",
    name: "Liabilities",
    type: "LIABILITY",
    isSystem: true,
    isPostable: false,
  });
  const equity = await upsertAccount({
    code: "3000",
    name: "Equity",
    type: "EQUITY",
    isSystem: true,
    isPostable: false,
  });
  const revenue = await upsertAccount({
    code: "4000",
    name: "Revenue",
    type: "REVENUE",
    isSystem: true,
    isPostable: false,
  });
  const expense = await upsertAccount({
    code: "5000",
    name: "Expense",
    type: "EXPENSE",
    isSystem: true,
    isPostable: false,
  });

  const accounts: AccountSeed[] = [
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
    {
      code: "1260",
      name: "Fixed Assets",
      type: "ASSET",
      subType: "FIXED_ASSET",
      parentId: assets.id,
      isPostable: true,
    },
    {
      code: "2140",
      name: "Bank Loan",
      type: "LIABILITY",
      subType: "LONG_TERM_LIABILITY",
      parentId: liabilities.id,
      isPostable: true,
    },
    {
      code: "2150",
      name: "Director Loan",
      type: "LIABILITY",
      subType: "LONG_TERM_LIABILITY",
      parentId: liabilities.id,
      isPostable: true,
    },
    {
      code: "2160",
      name: "Security Deposit Received",
      type: "LIABILITY",
      subType: "CURRENT_LIABILITY",
      parentId: liabilities.id,
      isPostable: true,
    },
    {
      code: "3010",
      name: "Owner's Capital",
      type: "EQUITY",
      subType: "EQUITY",
      parentId: equity.id,
      isPostable: true,
    },
    {
      code: "3020",
      name: "Retained Earnings",
      type: "EQUITY",
      subType: "EQUITY",
      parentId: equity.id,
      isPostable: true,
    },
  ];

  for (const account of accounts) {
    await upsertAccount(account);
  }

  await prisma.chartOfAccount.updateMany({
    where: { code: { in: ["5170", "5180", "1220"] } },
    data: { isActive: false },
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
