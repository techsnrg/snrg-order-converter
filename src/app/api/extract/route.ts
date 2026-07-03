import OpenAI from "openai";
import { NextResponse } from "next/server";
import { sampleItemMaster } from "@/data/sample-item-master";
import { matchLines } from "@/lib/matching";
import { readRecentCorrectionExamples } from "@/lib/supabase/corrections";
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

function formatCorrectionExamples(examples: Awaited<ReturnType<typeof readRecentCorrectionExamples>>) {
  if (!examples.length) return "";

  const lines = examples.map(
    (example, index) =>
      `${index + 1}. Written: "${example.handwrittenText}" -> corrected item ${example.correctedItemCode}, qty ${
        example.correctedErpQty
      } ${example.correctedUom}`
  );

  return `\n\nRecent coordinator corrections to learn from:\n${lines.join("\n")}`;
}

function normalizeCodeText(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function getAlphaCodePrefix(value: string) {
  const compact = normalizeCodeText(value);
  const match = compact.match(/^([A-Z]+)\d+$/);
  return match?.[1] || "";
}

function getNumericSuffix(value: string) {
  const match = value.match(/(\d{2,})\s*$/);
  return match?.[1] || "";
}

function expandDittoShorthand(lines: ExtractedLine[]) {
  let previousAlphaPrefix = "";

  return lines.map((line) => {
    const currentPrefix = getAlphaCodePrefix(line.itemHint);
    if (currentPrefix) {
      previousAlphaPrefix = currentPrefix;
      return line;
    }

    const hasDittoSignal = /["'“”〃]/.test(line.itemHint) || /^\s*[un]\s*\d{2,}/i.test(line.itemHint);
    const suffix = getNumericSuffix(line.itemHint);

    if (!previousAlphaPrefix || !hasDittoSignal || !suffix) {
      return line;
    }

    const expandedHint = `${previousAlphaPrefix}${suffix}`;
    return {
      ...line,
      itemHint: expandedHint,
      notes: [line.notes, `Expanded shorthand "${line.itemHint}" as ${expandedHint}`].filter(Boolean).join("; ")
    };
  });
}

function getOpenAIErrorResponse(error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
  const code =
    typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : "";

  if (status === 401) {
    return NextResponse.json({ error: "OpenAI API key is invalid. Please update OPENAI_API_KEY." }, { status: 401 });
  }

  if (status === 429 && code === "insufficient_quota") {
    return NextResponse.json(
      { error: "OpenAI quota is not available. Please enable billing or add credits for this OpenAI project." },
      { status: 429 }
    );
  }

  if (status === 429) {
    return NextResponse.json({ error: "OpenAI rate limit reached. Please try again shortly." }, { status: 429 });
  }

  return NextResponse.json({ error: "OpenAI extraction failed. Please try again." }, { status: 500 });
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
  const correctionExamples = await readRecentCorrectionExamples();

  try {
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
                "Read quantities and units carefully. If a row is unclear, still include it and explain uncertainty in notes. " +
                "When a salesperson uses ditto marks, forward quotes, repeated quote marks, or shorthand such as 'n 010' under a previous alphabetic item code like GCSP006, infer that the previous alphabetic prefix continues and the suffix changes, so 'n 010' means GCSP010. " +
                "Keep the original visible row in handwrittenText, but put the fully inferred item shorthand in itemHint." +
                formatCorrectionExamples(correctionExamples)
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
      lines: matchLines(expandDittoShorthand(parsed.lines || []), itemMaster)
    });
  } catch (error) {
    return getOpenAIErrorResponse(error);
  }
}
