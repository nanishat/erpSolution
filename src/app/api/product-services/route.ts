import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  createProductService,
  listProductServices,
} from "@/modules/products/services/product-service.service";
import { productServiceErrorResponse } from "@/modules/products/utils/product-service-error-response";
import {
  createProductServiceSchema,
  listProductServicesQuerySchema,
} from "@/modules/products/validations/product-service.schema";

export async function GET(request: NextRequest) {
  const query = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = listProductServicesQuerySchema.safeParse(query);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query parameters" },
      { status: 400 }
    );
  }

  const productServices = await listProductServices(parsed.data);
  return NextResponse.json({ data: productServices });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createProductServiceSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const productService = await createProductService(parsed.data);
    return NextResponse.json({ data: productService }, { status: 201 });
  } catch (error) {
    return productServiceErrorResponse(error);
  }
}
