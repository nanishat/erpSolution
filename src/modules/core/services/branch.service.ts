import { db } from "@/lib/db";

export type BranchOption = {
  id: string;
  name: string;
  code: string;
  isHeadOffice: boolean;
};

export async function getBranches(): Promise<BranchOption[]> {
  return db.branch.findMany({
    orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
    select: { id: true, name: true, code: true, isHeadOffice: true },
  });
}
