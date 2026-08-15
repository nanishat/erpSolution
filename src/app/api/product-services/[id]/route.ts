import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  deactivateProductService,
  getProductServiceById,
  updateProductService,
} from "@/modules/products/services/product-service.service";
import { productServiceErrorResponse } from "@/modules/products/utils/product-service-error-response";
import { updateProductServiceSchema } from "@/modules/products/validations/product-service.schema";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/product-services/[id]">
) {
  const { id } = await ctx.params;

  try {
    const productService = await getProductServiceById(id);
    return NextResponse.json({ data: productService });
  } catch (error) {
    return productServiceErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/product-services/[id]">
) {
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = updateProductServiceSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const productService = await updateProductService(id, parsed.data);
    return NextResponse.json({ data: productService });
  } catch (error) {
    return productServiceErrorResponse(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/product-services/[id]">
) {
  const { id } = await ctx.params;

  try {
    const productService = await deactivateProductService(id);
    return NextResponse.json({ data: productService });
  } catch (error) {
    return productServiceErrorResponse(error);
  }
}
