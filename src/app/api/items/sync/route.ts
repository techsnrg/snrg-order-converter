import { NextResponse } from "next/server";
import { fetchErpNextItems } from "@/lib/erpnext/items";

export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await fetchErpNextItems();
    return NextResponse.json({
      items: result.items,
      count: result.items.length,
      syncedAt: new Date().toISOString(),
      warning: result.warning,
      requiresCustomFieldSetup: result.requiresCustomFieldSetup
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
