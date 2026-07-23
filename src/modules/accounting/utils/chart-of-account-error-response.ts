import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  ChartOfAccountDeletionNotAllowedError,
  ChartOfAccountNotFoundError,
  DuplicateChartOfAccountCodeError,
  InvalidChartOfAccountHierarchyError,
} from "@/modules/accounting/services/chart-of-account.service";

export function chartOfAccountErrorResponse(error: unknown): NextResponse {
  if (error instanceof ChartOfAccountNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof DuplicateChartOfAccountCodeError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (
    error instanceof InvalidChartOfAccountHierarchyError ||
    error instanceof ChartOfAccountDeletionNotAllowedError
  ) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return NextResponse.json(
      { error: "A record with this code already exists" },
      { status: 409 }
    );
  }

  console.error(error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
