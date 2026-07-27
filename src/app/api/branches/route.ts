import { NextResponse } from "next/server";

import { getBranches } from "@/modules/core/services/branch.service";

export async function GET() {
  const branches = await getBranches();
  return NextResponse.json({ data: branches });
}
