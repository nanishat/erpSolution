import { NextResponse } from "next/server";

import {
  DuplicateProductServiceCodeError,
  ExpenseAccountNotFoundError,
  IncomeAccountNotFoundError,
  ProductServiceNotFoundError,
} from "@/modules/products/services/product-service.service";

export function productServiceErrorResponse(error: unknown): NextResponse {
  if (error instanceof ProductServiceNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof DuplicateProductServiceCodeError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (
    error instanceof IncomeAccountNotFoundError ||
    error instanceof ExpenseAccountNotFoundError
  ) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  console.error(error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
