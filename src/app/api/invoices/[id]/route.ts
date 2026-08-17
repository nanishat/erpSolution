import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getInvoiceById } from "@/modules/invoicing/services/invoice.service";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/invoices/[id]">) {
  const { id } = await ctx.params;

  const invoice = await getInvoiceById(id);
  if (!invoice) {
    return NextResponse.json({ error: `Invoice ${id} not found` }, { status: 404 });
  }

  return NextResponse.json({ data: invoice });
}
