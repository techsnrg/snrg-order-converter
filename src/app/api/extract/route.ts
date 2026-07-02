import OpenAI from "openai";
import { NextResponse } from "next/server";
import { sampleItemMaster } from "@/data/sample-item-master";
import { matchLines } from "@/lib/matching";
import type { ExtractedLine, ItemMasterRow } from "@/lib/types";

export const runtime = "nodejs";

const extractionSchema = {
  name: "handwritten_order_extraction",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["customerName", "lines"],
    properties: {
      customerName: {
        type: "string",
        description: "Customer or shop name if visible, otherwise empty string."
      },
      lines: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["handwrittenText", "itemHint", "quantity", "unit", "notes"],
          properties: {
            handwrittenText: {
              type: "string",
              description: "The full row as written on the page."
            },
            itemHint: {
              type: "string",
              description: "The product/item shorthand exactly as read, excluding quantity."
            },
            quantity: {
              type: "number",
              description: "Numeric quantity written by the salesperson."
            },
            unit: {
              type: "string",
              description: "Unit such as CTN, BOX, PE, PCS, or Nos."
            },
            notes: {
              type: "string",
              description: "Any uncertainty or extra note, otherwise empty string."
            }
          }
        }
      }
    }
  },
  strict: true
};

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function parseItemMaster(value: FormDataEntryValue | null): ItemMasterRow[] {
  if (!value || typeof value !== "string") return sampleItemMaster;
  try {
    const parsed = JSON.parse(value) as ItemMasterRow[];
    return parsed.length ? parsed : sampleItemMaster;
  } catch {
    return sampleItemMaster;
  }
}

async function fileToDataUrl(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  return `data:${file.type || "image/jpeg"};base64,${buffer.toString("base64")}`;
}

function demoLines(): ExtractedLine[] {
  return [
    { handwrittenText: "10105 VB - 01 CTN", itemHint: "10105 VB", quantity: 1, unit: "CTN", notes: "Demo row" },
    { handwrittenText: "10106 VB - 01 CTN", itemHint: "10106 VB", quantity: 1, unit: "CTN", notes: "Demo row" },
    { handwrittenText: "10132 VB - 01 CTN", itemHint: "10132 VB", quantity: 1, unit: "CTN", notes: "Demo row" },
    { handwrittenText: "GCP006 010 - 10 Box", itemHint: "GCP006 010", quantity: 10, unit: "BOX", notes: "Demo row" }
  ];
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("image");
  const itemMaster = parseItemMaster(formData.get("itemMaster"));

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Please upload an order image." }, { status: 400 });
  }

  const client = getOpenAIClient();

  if (!client) {
    const lines = demoLines();
    return NextResponse.json({
      customerName: "Demo extraction",
      lines: matchLines(lines, itemMaster),
      warning: "OPENAI_API_KEY is not configured. Returning demo rows so the review and Excel flow can be tested."
    });
  }

  const imageUrl = await fileToDataUrl(file);
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Extract this handwritten sales order into structured rows. Preserve the written item shorthand. " +
              "Read quantities and units carefully. If a row is unclear, still include it and explain uncertainty in notes."
          },
          {
            type: "input_image",
            image_url: imageUrl,
            detail: "high"
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        ...extractionSchema
      }
    }
  });

  const parsed = JSON.parse(response.output_text || "{}") as {
    customerName?: string;
    lines?: ExtractedLine[];
  };

  return NextResponse.json({
    customerName: parsed.customerName || "",
    lines: matchLines(parsed.lines || [], itemMaster)
  });
}
