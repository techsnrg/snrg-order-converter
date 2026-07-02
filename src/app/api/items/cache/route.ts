import { NextResponse } from "next/server";
import {
  isCatalogueCacheConfigured,
  readCatalogueCache,
  writeCatalogueCache
} from "@/lib/supabase/catalogue-cache";
import type { ItemMasterRow } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const cache = await readCatalogueCache();

    return NextResponse.json({
      configured: isCatalogueCacheConfigured(),
      cache
    });
  } catch (error) {
    return NextResponse.json(
      {
        configured: isCatalogueCacheConfigured(),
        cache: null,
        error: error instanceof Error ? error.message : "Could not read shared item catalogue."
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      items?: ItemMasterRow[];
      source?: string;
    };

    if (!Array.isArray(body.items)) {
      return NextResponse.json({ error: "Catalogue items are required." }, { status: 400 });
    }

    const cache = await writeCatalogueCache(body.items, body.source || "Manual");

    if (!cache) {
      return NextResponse.json(
        {
          error: "Supabase catalogue cache is not configured."
        },
        { status: 503 }
      );
    }

    return NextResponse.json({ cache });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not save shared item catalogue."
      },
      { status: 500 }
    );
  }
}
