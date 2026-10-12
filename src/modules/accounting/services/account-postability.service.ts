import type { Prisma } from "@prisma/client";

export class NonPostableAccountJournalLineError extends Error {
  constructor(accountId: string, code: string) {
    super(`Account ${code} (${accountId}) is non-postable and cannot be used on a journal line`);
    this.name = "NonPostableAccountJournalLineError";
  }
}

export async function assertAccountPostable(
  tx: Prisma.TransactionClient,
  accountIds: string[]
): Promise<void> {
  const uniqueAccountIds = [...new Set(accountIds)];
  const accounts = await tx.chartOfAccount.findMany({
    where: { id: { in: uniqueAccountIds } },
    select: { id: true, code: true, isPostable: true },
  });
  const accountsById = new Map(accounts.map((account) => [account.id, account]));

  for (const accountId of uniqueAccountIds) {
    const account = accountsById.get(accountId);
    if (account && !account.isPostable) {
      throw new NonPostableAccountJournalLineError(account.id, account.code);
    }
  }
}
