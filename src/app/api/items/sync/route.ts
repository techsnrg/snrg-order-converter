import { NextResponse } from "next/server";
import { fetchErpNextItems } from "@/lib/erpnext/items";
import { writeCatalogueCache } from "@/lib/supabase/catalogue-cache";

export const runtime = "nodejs";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: unknown) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }

      try {
        const result = await fetchErpNextItems((progress) => {
          send({ event: "progress", ...progress });
        });
        let supabaseWarning = "";

        try {
          const cache = await writeCatalogueCache(result.items, "ERPNext");
          if (!cache) {
            supabaseWarning = "Supabase catalogue cache is not configured.";
          }
        } catch (error) {
          supabaseWarning = error instanceof Error ? error.message : "Could not save shared catalogue cache.";
        }

        send({
          event: "result",
          items: result.items,
          count: result.items.length,
          syncedAt: new Date().toISOString(),
          warning: [result.warning, supabaseWarning].filter(Boolean).join(" "),
          requiresCustomFieldSetup: result.requiresCustomFieldSetup
        });
      } catch (error) {
        send({
          event: "error",
          error: error instanceof Error ? error.message : "Could not sync ERPNext items."
        });
      } finally {
        controller.close();
      }
    }
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
