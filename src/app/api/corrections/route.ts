import { NextResponse } from "next/server";
import { saveCorrections } from "@/lib/supabase/corrections";
import type { ConvertedLine } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      customerName?: string;
      imageName?: string;
      originalRows?: ConvertedLine[];
      correctedRows?: ConvertedLine[];
    };

    if (!Array.isArray(body.correctedRows) || !body.correctedRows.length) {
      return NextResponse.json({ error: "Corrected rows are required." }, { status: 400 });
    }

    const result = await saveCorrections({
      customerName: body.customerName || "",
      imageName: body.imageName || "",
      originalRows: Array.isArray(body.originalRows) ? body.originalRows : [],
      correctedRows: body.correctedRows
    });

    if (!result) {
      return NextResponse.json(
        {
          error: "Supabase correction history is not configured."
        },
        { status: 503 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not save correction history."
      },
      { status: 500 }
    );
  }
}
