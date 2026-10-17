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

type ChartOfAccountRow = Prisma.ChartOfAccountGetPayload<{
  include: typeof chartOfAccountWithChildrenInclude;
}>;

// openingBalance is a Prisma Decimal (on both the account itself and each
// row in `children`, since `children: true` pulls in full ChartOfAccount
// rows), which React Server Components can't pass to "use client"
// components ("Decimal objects are not supported") — convert every one to a
// plain number before this ever reaches a page/component, mirroring
// serializeProductService().
export type ChartOfAccountWithChildren = Omit<ChartOfAccountRow, "openingBalance" | "children"> & {
  openingBalance: number;
  children: (Omit<ChartOfAccountRow["children"][number], "openingBalance"> & {
    openingBalance: number;
  })[];
};

function serializeChartOfAccount(account: ChartOfAccountRow): ChartOfAccountWithChildren {
  return {
    ...account,
    openingBalance: Number(account.openingBalance),
    children: account.children.map((child) => ({
      ...child,
      openingBalance: Number(child.openingBalance),
    })),
  };
}

export async function getActiveChartOfAccounts(): Promise<ChartOfAccountOption[]> {
  return db.chartOfAccount.findMany({
    where: { isActive: true, isPostable: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, subType: true, isPostable: true },
  });
}

// For the bank-reconciliation import picker — same shape as
// getActiveChartOfAccounts, further narrowed to isReconcilable so a user
// can't pick an account importBankStatement would reject anyway
// (ReconciliationAccountNotFoundError).
export async function getReconcilableChartOfAccounts(): Promise<ChartOfAccountOption[]> {
  return db.chartOfAccount.findMany({
    where: { isActive: true, isReconcilable: true, isPostable: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, subType: true, isPostable: true },
  });
}

export async function listChartOfAccounts(
  filter: ListChartOfAccountsQuery
): Promise<ChartOfAccountWithChildren[]> {
  const where: Prisma.ChartOfAccountWhereInput = {
    type: filter.type,
    subType: filter.subType,
    isActive: filter.isActive === "all" ? undefined : filter.isActive,
    parentId: filter.parentId,
    ...(filter.search && {
      OR: [
        { code: { contains: filter.search, mode: "insensitive" } },
        { name: { contains: filter.search, mode: "insensitive" } },
      ],
    }),
  };
  const accounts = await db.chartOfAccount.findMany({
    where,
    include: chartOfAccountWithChildrenInclude,
    orderBy: { code: "asc" },
  });
  return accounts.map(serializeChartOfAccount);
}

export type PaginatedChartOfAccount = {
  id: string;
  code: string;
  name: string;
  type: ChartOfAccountRow["type"];
  subType: ChartOfAccountRow["subType"];
  parentId: string | null;
  isPostable: boolean;
  isActive: boolean;
};

export async function getPaginatedChartOfAccounts({
  page,
  pageSize,
  search,
  type,
  isActive,
}: {
  page: number;
  pageSize: number;
  search?: string;
  type?: ChartOfAccountRow["type"];
  isActive?: boolean | "all";
}): Promise<{ items: PaginatedChartOfAccount[]; total: number; page: number }> {
  const where: Prisma.ChartOfAccountWhereInput = {
    ...(type && { type }),
    ...(isActive !== "all" && { isActive: isActive ?? true }),
    ...(search && {
      OR: [
        { code: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
      ],
    }),
  };
  const total = await db.chartOfAccount.count({ where });
  const currentPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  const items = await db.chartOfAccount.findMany({
    where,
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      subType: true,
      parentId: true,
      isPostable: true,
      isActive: true,
    },
    orderBy: { code: "asc" },
    skip: (currentPage - 1) * pageSize,
    take: pageSize,
  });
  return { items, total, page: currentPage };
}

export async function getChartOfAccountById(id: string): Promise<ChartOfAccountWithChildren> {
  const account = await db.chartOfAccount.findUnique({
    where: { id },
    include: chartOfAccountWithChildrenInclude,
  });

  if (!account) {
    throw new ChartOfAccountNotFoundError(id);
  }

  return serializeChartOfAccount(account);
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

async function assertParentCanAcceptChild(
  tx: Prisma.TransactionClient,
  parentId: string,
  childType: CreateChartOfAccountInput["type"],
  isAddingChild = true
): Promise<boolean> {
  const parent = await tx.chartOfAccount.findUnique({
    where: { id: parentId },
    select: {
      type: true,
      isPostable: true,
      journalLines: { take: 1, select: { id: true } },
    },
  });
  if (!parent) {
    throw new InvalidChartOfAccountHierarchyError(`Parent account ${parentId} does not exist`);
  }
  if (parent.type !== childType) {
    throw new InvalidChartOfAccountHierarchyError(
      `Child account type (${childType}) must match parent account type (${parent.type})`
    );
  }
  if (isAddingChild && parent.isPostable && parent.journalLines.length > 0) {
    throw new InvalidChartOfAccountHierarchyError(
      "Cannot add a sub-account to a postable account that has journal lines"
    );
  }
  return isAddingChild && parent.isPostable;
}

async function makeParentNonPostable(
  tx: Prisma.TransactionClient,
  parentId: string,
  wasPostable: boolean
): Promise<void> {
  if (wasPostable) {
    await tx.chartOfAccount.update({
      where: { id: parentId },
      data: { isPostable: false },
    });
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

    let parentWasPostable = false;
    if (input.parentId) {
      parentWasPostable = await assertParentCanAcceptChild(tx, input.parentId, input.type);
    }

    try {
      const created = await tx.chartOfAccount.create({
        data: {
          code: input.code,
          name: input.name,
          description: input.description,
          type: input.type,
          subType: input.subType,
          parentId: input.parentId,
          isReconcilable: input.isReconcilable ?? false,
          isPostable: input.isPostable ?? true,
          currencyCode: input.currencyCode,
          openingBalance: input.openingBalance,
          openingBalanceDate: input.openingBalanceDate,
          // TODO: derive createdById from the authenticated session once auth is wired up.
          createdById: input.createdById,
        },
        include: chartOfAccountWithChildrenInclude,
      });
      if (input.parentId) {
        await makeParentNonPostable(tx, input.parentId, parentWasPostable);
      }
      return serializeChartOfAccount(created);
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
      include: { journalLines: { take: 1 }, children: { take: 1 } },
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

    if (input.isPostable === true && existing.children.length > 0) {
      throw new InvalidChartOfAccountHierarchyError(
        "An account with sub-accounts cannot be postable"
      );
    }
    if (
      input.isPostable === false &&
      existing.isPostable &&
      existing.children.length === 0 &&
      existing.journalLines.length > 0
    ) {
      throw new ChartOfAccountDeletionNotAllowedError(
        "An account with journal lines cannot be made non-postable"
      );
    }

    const nextType = input.type ?? existing.type;
    let parentWasPostable = false;

    if (input.parentId) {
      const existingChild = await tx.chartOfAccount.findFirst({ where: { parentId: id } });
      if (existingChild) {
        throw new InvalidChartOfAccountHierarchyError(
          "Cannot assign a parent to an account that already has sub-accounts (max 2 levels)"
        );
      }
      await assertNoCycle(tx, id, input.parentId);
      parentWasPostable = await assertParentCanAcceptChild(
        tx,
        input.parentId,
        nextType,
        input.parentId !== existing.parentId
      );
    }

    try {
      const updated = await tx.chartOfAccount.update({
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
          isPostable: input.isPostable,
          currencyCode: input.currencyCode,
          openingBalance: input.openingBalance,
          openingBalanceDate: input.openingBalanceDate,
        },
        include: chartOfAccountWithChildrenInclude,
      });
      if (input.parentId && input.parentId !== existing.parentId) {
        await makeParentNonPostable(tx, input.parentId, parentWasPostable);
      }
      return serializeChartOfAccount(updated);
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

  const deactivated = await db.chartOfAccount.update({
    where: { id },
    data: { isActive: false },
    include: chartOfAccountWithChildrenInclude,
  });
  return serializeChartOfAccount(deactivated);
}
