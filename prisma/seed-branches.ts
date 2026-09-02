// Renames the existing Head Office branch row to "Dhaka [HO]" (same id/code,
// preserving all existing JournalEntry/JournalLine/Invoice FK references) and
// seeds the 18 remaining branch offices. Safe to run more than once.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const HEAD_OFFICE_CODE = "HO";
const HEAD_OFFICE_NAME = "Dhaka [HO]";

const BRANCHES: { code: string; name: string }[] = [
  { code: "CTG", name: "Chittagong" },
  { code: "NGJ", name: "Narayanganj" },
  { code: "SRJ", name: "Sirajganj" },
  { code: "CML", name: "Cumilla" },
  { code: "LXP", name: "Laxmipur" },
  { code: "MJD", name: "Maijdee (Court)" },
  { code: "CXB", name: "Coxs Bazar" },
  { code: "BOG", name: "Bogura" },
  { code: "RAJ", name: "Rajshahi" },
  { code: "KHL", name: "Khulna" },
  { code: "THK", name: "Thakurgaon" },
  { code: "RNG", name: "Rangpur" },
  { code: "BBR", name: "B. Baria" },
  { code: "HBG", name: "Habiganj" },
  { code: "SHB", name: "Shetabganj" },
  { code: "DNJ", name: "Dinajpur" },
  { code: "BRS", name: "Barishal" },
  { code: "SYL", name: "Sylhet" },
];

async function main() {
  const headOffice = await prisma.branch.findUnique({ where: { code: HEAD_OFFICE_CODE } });
  if (!headOffice) {
    throw new Error(
      `No existing Branch row with code "${HEAD_OFFICE_CODE}" found — refusing to create a new ` +
        `Head Office row. Investigate before proceeding.`
    );
  }
  if (!headOffice.isHeadOffice) {
    throw new Error(
      `Branch row with code "${HEAD_OFFICE_CODE}" (id ${headOffice.id}) is not flagged isHeadOffice — ` +
        `refusing to rename. Investigate before proceeding.`
    );
  }

  if (headOffice.name !== HEAD_OFFICE_NAME) {
    await prisma.branch.update({
      where: { id: headOffice.id },
      data: { name: HEAD_OFFICE_NAME },
    });
    console.log(`Renamed Head Office (id ${headOffice.id}): "${headOffice.name}" -> "${HEAD_OFFICE_NAME}"`);
  } else {
    console.log(`Head Office (id ${headOffice.id}) already named "${HEAD_OFFICE_NAME}" — skipping.`);
  }

  for (const branch of BRANCHES) {
    const existing = await prisma.branch.findUnique({ where: { code: branch.code } });
    if (existing) {
      console.log(`Branch ${branch.code} already exists (id ${existing.id}) — skipping.`);
      continue;
    }

    const created = await prisma.branch.create({
      data: { code: branch.code, name: branch.name, isHeadOffice: false },
    });
    console.log(`Created branch: ${created.code} ${created.name} (id ${created.id})`);
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
