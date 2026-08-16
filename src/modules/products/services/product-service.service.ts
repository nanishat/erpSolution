import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type {
  CreateProductServiceInput,
  ListProductServicesQuery,
  UpdateProductServiceInput,
} from "@/modules/products/validations/product-service.schema";

const productServiceWithAccountsInclude = {
  incomeAccount: { select: { id: true, code: true, name: true } },
  expenseAccount: { select: { id: true, code: true, name: true } },
} satisfies Prisma.ProductServiceInclude;

type ProductServiceRow = Prisma.ProductServiceGetPayload<{
  include: typeof productServiceWithAccountsInclude;
}>;

// unitPrice is a Prisma Decimal, which React Server Components can't pass to
// "use client" components ("Decimal objects are not supported") — convert to
// a plain number before it ever reaches a page/component, mirroring how
// getTrialBalance() converts its Decimal sums to number at the service layer.
export type ProductServiceWithAccounts = Omit<ProductServiceRow, "unitPrice"> & {
  unitPrice: number;
};

function serializeProductService(productService: ProductServiceRow): ProductServiceWithAccounts {
  return { ...productService, unitPrice: Number(productService.unitPrice) };
}

export class ProductServiceNotFoundError extends Error {
  constructor(id: string) {
    super(`Product/service ${id} not found`);
    this.name = "ProductServiceNotFoundError";
  }
}

export class DuplicateProductServiceCodeError extends Error {
  constructor(code: string) {
    super(`Product/service code "${code}" is already in use`);
    this.name = "DuplicateProductServiceCodeError";
  }
}

export class IncomeAccountNotFoundError extends Error {
  constructor(id: string) {
    super(`Income account ${id} not found or inactive`);
    this.name = "IncomeAccountNotFoundError";
  }
}

export class ExpenseAccountNotFoundError extends Error {
  constructor(id: string) {
    super(`Expense account ${id} not found or inactive`);
    this.name = "ExpenseAccountNotFoundError";
  }
}

export async function listProductServices(
  filter: ListProductServicesQuery
): Promise<ProductServiceWithAccounts[]> {
  const where: Prisma.ProductServiceWhereInput = {
    type: filter.type,
    // Default list excludes deactivated rows; pass isActive=false explicitly to see them.
    isActive: filter.isActive ?? true,
  };

  if (filter.search) {
    where.OR = [
      { code: { contains: filter.search, mode: "insensitive" } },
      { name: { contains: filter.search, mode: "insensitive" } },
    ];
  }

  const productServices = await db.productService.findMany({
    where,
    include: productServiceWithAccountsInclude,
    orderBy: { code: "asc" },
  });

  return productServices.map(serializeProductService);
}

export async function getProductServiceById(id: string): Promise<ProductServiceWithAccounts> {
  const productService = await db.productService.findUnique({
    where: { id },
    include: productServiceWithAccountsInclude,
  });

  if (!productService) {
    throw new ProductServiceNotFoundError(id);
  }

  return serializeProductService(productService);
}

async function assertActiveAccountExists(
  tx: Prisma.TransactionClient,
  accountId: string,
  ErrorClass: new (id: string) => Error
): Promise<void> {
  const account = await tx.chartOfAccount.findUnique({
    where: { id: accountId },
    select: { isActive: true },
  });
  if (!account || !account.isActive) {
    throw new ErrorClass(accountId);
  }
}

export async function createProductService(
  input: CreateProductServiceInput
): Promise<ProductServiceWithAccounts> {
  return db.$transaction(async (tx) => {
    const existingCode = await tx.productService.findUnique({ where: { code: input.code } });
    if (existingCode) {
      throw new DuplicateProductServiceCodeError(input.code);
    }

    await assertActiveAccountExists(tx, input.incomeAccountId, IncomeAccountNotFoundError);
    if (input.expenseAccountId) {
      await assertActiveAccountExists(tx, input.expenseAccountId, ExpenseAccountNotFoundError);
    }

    try {
      const created = await tx.productService.create({
        data: {
          code: input.code,
          name: input.name,
          description: input.description,
          type: input.type,
          unitPrice: input.unitPrice,
          unit: input.unit,
          incomeAccountId: input.incomeAccountId,
          expenseAccountId: input.expenseAccountId,
          // TODO: derive createdById from the authenticated session once auth is wired up.
          createdById: input.createdById,
        },
        include: productServiceWithAccountsInclude,
      });
      return serializeProductService(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new DuplicateProductServiceCodeError(input.code);
      }
      throw error;
    }
  });
}

export async function updateProductService(
  id: string,
  input: UpdateProductServiceInput
): Promise<ProductServiceWithAccounts> {
  return db.$transaction(async (tx) => {
    const existing = await tx.productService.findUnique({ where: { id } });
    if (!existing) {
      throw new ProductServiceNotFoundError(id);
    }

    if (input.code && input.code !== existing.code) {
      const codeOwner = await tx.productService.findUnique({ where: { code: input.code } });
      if (codeOwner) {
        throw new DuplicateProductServiceCodeError(input.code);
      }
    }

    if (input.incomeAccountId) {
      await assertActiveAccountExists(tx, input.incomeAccountId, IncomeAccountNotFoundError);
    }
    if (input.expenseAccountId) {
      await assertActiveAccountExists(tx, input.expenseAccountId, ExpenseAccountNotFoundError);
    }

    try {
      const updated = await tx.productService.update({
        where: { id },
        data: {
          code: input.code,
          name: input.name,
          description: input.description,
          type: input.type,
          unitPrice: input.unitPrice,
          unit: input.unit,
          incomeAccountId: input.incomeAccountId,
          expenseAccountId: input.expenseAccountId,
          isActive: input.isActive,
        },
        include: productServiceWithAccountsInclude,
      });
      return serializeProductService(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new DuplicateProductServiceCodeError(input.code ?? existing.code);
      }
      throw error;
    }
  });
}

export async function deactivateProductService(id: string): Promise<ProductServiceWithAccounts> {
  const existing = await db.productService.findUnique({ where: { id } });
  if (!existing) {
    throw new ProductServiceNotFoundError(id);
  }

  const deactivated = await db.productService.update({
    where: { id },
    data: { isActive: false },
    include: productServiceWithAccountsInclude,
  });
  return serializeProductService(deactivated);
}
