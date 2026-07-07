import type { ConvertedLine } from "@/lib/types";
import { isUpstashConfigured, upstashCommand, upstashPipeline } from "./client";

export type CorrectionPayload = {
  customerName: string;
  imageName: string;
  originalRows: ConvertedLine[];
  correctedRows: ConvertedLine[];
};

export type CorrectionExample = {
  handwrittenText: string;
  correctedItemCode: string;
  correctedItemName: string;
  correctedErpQty: number;
  correctedUom: string;
  extractedItemCode: string;
  extractedErpQty: number;
  extractedUom: string;
};

type StoredCorrection = {
  customer_name: string;
  image_name: string;
  row_index: number;
  handwritten_text: string;
  extracted_item_hint: string;
  extracted_quantity: number;
  extracted_unit: string;
  extracted_item_code: string;
  extracted_item_name: string;
  extracted_erp_qty: number;
  extracted_uom: string;
  corrected_item_code: string;
  corrected_item_name: string;
  corrected_erp_qty: number;
  corrected_uom: string;
  confidence: number;
  match_reason: string;
  was_changed: boolean;
  created_at: string;
};

const correctionsKey = "order_converter:corrections";
const maxStoredCorrections = 500;

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function wasChanged(original: ConvertedLine | undefined, corrected: ConvertedLine) {
  if (!original) return true;

  return (
    original.itemCode !== corrected.itemCode ||
    original.itemName !== corrected.itemName ||
    Number(original.erpQty) !== Number(corrected.erpQty) ||
    original.uom !== corrected.uom ||
    original.needsReview !== corrected.needsReview
  );
}

export async function saveCorrections(payload: CorrectionPayload) {
  if (!isUpstashConfigured()) return null;

  const now = new Date().toISOString();
  const rows: StoredCorrection[] = payload.correctedRows.map((corrected, index) => {
    const original = payload.originalRows[index];

    return {
      customer_name: payload.customerName || "",
      image_name: payload.imageName || "",
      row_index: index,
      handwritten_text: corrected.handwrittenText || original?.handwrittenText || "",
      extracted_item_hint: original?.itemHint || corrected.itemHint || "",
      extracted_quantity: original?.quantity ?? corrected.quantity ?? 0,
      extracted_unit: original?.unit || corrected.unit || "",
      extracted_item_code: original?.itemCode || "",
      extracted_item_name: original?.itemName || "",
      extracted_erp_qty: original?.erpQty ?? 0,
      extracted_uom: original?.uom || "",
      corrected_item_code: corrected.itemCode || "",
      corrected_item_name: corrected.itemName || "",
      corrected_erp_qty: corrected.erpQty || 0,
      corrected_uom: corrected.uom || "",
      confidence: original?.confidence ?? corrected.confidence ?? 0,
      match_reason: original?.matchReason || corrected.matchReason || "",
      was_changed: wasChanged(original, corrected),
      created_at: now
    };
  });

  await upstashPipeline([
    ["LPUSH", correctionsKey, ...rows.map((row) => JSON.stringify(row))],
    ["LTRIM", correctionsKey, 0, maxStoredCorrections - 1]
  ]);

  return {
    saved: rows.length,
    changed: rows.filter((row) => row.was_changed).length
  };
}

export async function readRecentCorrectionExamples(limit = 12): Promise<CorrectionExample[]> {
  const rows = await upstashCommand<string[]>(["LRANGE", correctionsKey, 0, 99]);
  if (!rows?.length) return [];

  const seen = new Set<string>();
  const examples: CorrectionExample[] = [];

  for (const value of rows) {
    let row: StoredCorrection;
    try {
      row = JSON.parse(value) as StoredCorrection;
    } catch {
      continue;
    }

    if (!row.was_changed) continue;

    const key = `${normalizeText(row.handwritten_text)}:${row.corrected_item_code}`;
    if (seen.has(key)) continue;
    seen.add(key);

    examples.push({
      handwrittenText: row.handwritten_text,
      correctedItemCode: row.corrected_item_code,
      correctedItemName: row.corrected_item_name,
      correctedErpQty: Number(row.corrected_erp_qty),
      correctedUom: row.corrected_uom,
      extractedItemCode: row.extracted_item_code,
      extractedErpQty: Number(row.extracted_erp_qty),
      extractedUom: row.extracted_uom
    });

    if (examples.length >= limit) break;
  }

  return examples;
}
