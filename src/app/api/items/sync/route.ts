import { NextResponse } from "next/server";
import { fetchErpNextItems } from "@/lib/erpnext/items";

export const runtime = "nodejs";

export async function GET() {
  try {
    const items = await fetchErpNextItems();
    return NextResponse.json({
      items,
      count: items.length,
      syncedAt: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not sync ERPNext items."
      },
      { status: 500 }
    );
  }
}
