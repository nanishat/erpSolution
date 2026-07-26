import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { ChartOfAccountOption } from "@/modules/accounting/types/journal-entry.types";
import type {
  CreateChartOfAccountInput,
  ListChartOfAccountsQuery,
  UpdateChartOfAccountInput,
} from "@/modules/accounting/validations/chart-of-account.schema";

export class ChartOfAccountNotFoundError extends Error {
  constructor(id: string) {
    super(`Account ${id} not found`);
    this.name = "ChartOfAccountNotFoundError";
  }
}

export class DuplicateChartOfAccountCodeError extends Error {
  constructor(code: string) {
    super(`Account code "${code}" is already in use`);
    this.name = "DuplicateChartOfAccountCodeError";
  }
}

export class InvalidChartOfAccountHierarchyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidChartOfAccountHierarchyError";
  }
}

export class ChartOfAccountDeletionNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChartOfAccountDeletionNotAllowedError";
  }
}

const chartOfAccountWithChildrenInclude = {
  children: true,
} satisfies Prisma.ChartOfAccountInclude;

export type ChartOfAccountWithChildren = Prisma.ChartOfAccountGetPayload<{
  include: typeof chartOfAccountWithChildrenInclude;
}>;

export async function getActiveChartOfAccounts(): Promise<ChartOfAccountOption[]> {
  return db.chartOfAccount.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });
}

export async function listChartOfAccounts(
  filter: ListChartOfAccountsQuery
): Promise<ChartOfAccountWithChildren[]> {
  return db.chartOfAccount.findMany({
    where: {
      type: filter.type,
      subType: filter.subType,
      isActive: filter.isActive,
      parentId: filter.parentId,
    },
    include: chartOfAccountWithChildrenInclude,
    orderBy: { code: "asc" },
  });
}

export async function getChartOfAccountById(id: string): Promise<ChartOfAccountWithChildren> {
  const account = await db.chartOfAccount.findUnique({
    where: { id },
    include: chartOfAccountWithChildrenInclude,
  });

  if (!account) {
    throw new ChartOfAccountNotFoundError(id);
  }

  return account;
}

/** Walks the ancestor chain of `newParentId`; throws if `accountId` appears in it. */
async function assertNoCycle(
  tx: Prisma.TransactionClient,
  accountId: string,
  newParentId: string
): Promise<void> {
  if (newParentId === accountId) {
    throw new InvalidChartOfAccountHierarchyError("An account cannot be its own parent");
  }

  const visited = new Set<string>();
  let currentId: string | null = newParentId;

  while (currentId) {
    if (currentId === accountId) {
      throw new InvalidChartOfAccountHierarchyError(
        "Cannot set parent to a descendant account (circular hierarchy)"
      );
    }
    if (visited.has(currentId)) break;
    visited.add(currentId);

    const current: { parentId: string | null } | null = await tx.chartOfAccount.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    if (!current) {
      throw new InvalidChartOfAccountHierarchyError(`Parent account ${newParentId} does not exist`);
    }
    currentId = current.parentId;
  }
}

export async function createChartOfAccount(
  input: CreateChartOfAccountInput
): Promise<ChartOfAccountWithChildren> {
  return db.$transaction(async (tx) => {
    const existingCode = await tx.chartOfAccount.findUnique({ where: { code: input.code } });
    if (existingCode) {
      throw new DuplicateChartOfAccountCodeError(input.code);
    }

    if (input.parentId) {
      const parent = await tx.chartOfAccount.findUnique({
        where: { id: input.parentId },
        select: { type: true },
      });
      if (!parent) {
        throw new InvalidChartOfAccountHierarchyError(
          `Parent account ${input.parentId} does not exist`
        );
      }
      if (parent.type !== input.type) {
        throw new InvalidChartOfAccountHierarchyError(
          `Child account type (${input.type}) must match parent account type (${parent.type})`
        );
      }
    }

    try {
      return await tx.chartOfAccount.create({
        data: {
          code: input.code,
          name: input.name,
          description: input.description,
          type: input.type,
          subType: input.subType,
          parentId: input.parentId,
          isReconcilable: input.isReconcilable ?? false,
          currencyCode: input.currencyCode,
          openingBalance: input.openingBalance,
          openingBalanceDate: input.openingBalanceDate,
          // TODO: derive createdById from the authenticated session once auth is wired up.
          createdById: input.createdById,
        },
        include: chartOfAccountWithChildrenInclude,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new DuplicateChartOfAccountCodeError(input.code);
      }
      throw error;
    }
  });
}

export async function updateChartOfAccount(
  id: string,
  input: UpdateChartOfAccountInput
): Promise<ChartOfAccountWithChildren> {
  return db.$transaction(async (tx) => {
    const existing = await tx.chartOfAccount.findUnique({
      where: { id },
      include: { journalLines: { take: 1 } },
    });
    if (!existing) {
      throw new ChartOfAccountNotFoundError(id);
    }

    if (input.isActive === false) {
      if (existing.isSystem) {
        throw new ChartOfAccountDeletionNotAllowedError("System accounts cannot be deactivated");
      }
      if (existing.journalLines.length > 0) {
        throw new ChartOfAccountDeletionNotAllowedError(
          "Account has journal lines and cannot be deactivated"
        );
      }
    }

    if (input.code && input.code !== existing.code) {
      const codeOwner = await tx.chartOfAccount.findUnique({ where: { code: input.code } });
      if (codeOwner) {
        throw new DuplicateChartOfAccountCodeError(input.code);
      }
    }

    const nextType = input.type ?? existing.type;

    if (input.parentId) {
      const existingChild = await tx.chartOfAccount.findFirst({ where: { parentId: id } });
      if (existingChild) {
        throw new InvalidChartOfAccountHierarchyError(
          "Cannot assign a parent to an account that already has sub-accounts (max 2 levels)"
        );
      }
      await assertNoCycle(tx, id, input.parentId);
      const parent = await tx.chartOfAccount.findUnique({
        where: { id: input.parentId },
        select: { type: true },
      });
      if (!parent) {
        throw new InvalidChartOfAccountHierarchyError(
          `Parent account ${input.parentId} does not exist`
        );
      }
      if (parent.type !== nextType) {
        throw new InvalidChartOfAccountHierarchyError(
          `Child account type (${nextType}) must match parent account type (${parent.type})`
        );
      }
    }

    try {
      return await tx.chartOfAccount.update({
        where: { id },
        data: {
          code: input.code,
          name: input.name,
          description: input.description,
          type: input.type,
          subType: input.subType,
          parentId: input.parentId,
          isActive: input.isActive,
          isReconcilable: input.isReconcilable,
          currencyCode: input.currencyCode,
          openingBalance: input.openingBalance,
          openingBalanceDate: input.openingBalanceDate,
        },
        include: chartOfAccountWithChildrenInclude,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new DuplicateChartOfAccountCodeError(input.code ?? existing.code);
      }
      throw error;
    }
  });
}

export async function deactivateChartOfAccount(id: string): Promise<ChartOfAccountWithChildren> {
  const account = await db.chartOfAccount.findUnique({
    where: { id },
    include: { ...chartOfAccountWithChildrenInclude, journalLines: { take: 1 } },
  });

  if (!account) {
    throw new ChartOfAccountNotFoundError(id);
  }
  if (account.isSystem) {
    throw new ChartOfAccountDeletionNotAllowedError("System accounts cannot be deactivated");
  }
  if (account.journalLines.length > 0) {
    throw new ChartOfAccountDeletionNotAllowedError(
      "Account has journal lines and cannot be deactivated"
    );
  }

  return db.chartOfAccount.update({
    where: { id },
    data: { isActive: false },
    include: chartOfAccountWithChildrenInclude,
  });
}
