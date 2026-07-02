import { NextResponse } from "next/server";
import { fetchErpNextItems } from "@/lib/erpnext/items";

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

        send({
          event: "result",
          items: result.items,
          count: result.items.length,
          syncedAt: new Date().toISOString(),
          warning: result.warning,
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
