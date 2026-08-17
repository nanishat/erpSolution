import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createInvoice, getInvoices } from "@/modules/invoicing/services/invoice.service";
import { invoiceErrorResponse } from "@/modules/invoicing/utils/invoice-error-response";
import { createInvoiceSchema, listInvoicesQuerySchema } from "@/modules/invoicing/validations/invoice.schema";

export async function GET(request: NextRequest) {
  const query = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = listInvoicesQuerySchema.safeParse(query);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query parameters" },
      { status: 400 }
    );
  }

  const invoices = await getInvoices(parsed.data);
  return NextResponse.json({ data: invoices });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createInvoiceSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const invoice = await createInvoice(parsed.data);
    return NextResponse.json({ data: invoice }, { status: 201 });
  } catch (error) {
    return invoiceErrorResponse(error);
  }
}
