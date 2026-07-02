import type { ConvertedLine } from "@/lib/types";
import { getSupabaseHeaders, getSupabaseRestConfig } from "./catalogue-cache";

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

const tableName = "order_converter_corrections";

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
  const config = getSupabaseRestConfig();
  if (!config) return null;

  const rows = payload.correctedRows.map((corrected, index) => {
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
      was_changed: wasChanged(original, corrected)
    };
  });

  const response = await fetch(`${config.url}/rest/v1/${tableName}`, {
    method: "POST",
    headers: {
      ...getSupabaseHeaders(config.serviceRoleKey),
      Prefer: "return=minimal"
    },
    body: JSON.stringify(rows)
  });

  if (!response.ok) {
    throw new Error(`Could not save correction history: ${response.status}`);
  }

  return {
    saved: rows.length,
    changed: rows.filter((row) => row.was_changed).length
  };
}

export async function readRecentCorrectionExamples(limit = 12): Promise<CorrectionExample[]> {
  const config = getSupabaseRestConfig();
  if (!config) return [];

  const response = await fetch(
    `${config.url}/rest/v1/${tableName}?was_changed=eq.true&select=handwritten_text,corrected_item_code,corrected_item_name,corrected_erp_qty,corrected_uom,extracted_item_code,extracted_erp_qty,extracted_uom&order=created_at.desc&limit=${limit}`,
    {
      headers: getSupabaseHeaders(config.serviceRoleKey),
      cache: "no-store"
    }
  );

  if (!response.ok) return [];

  const rows = (await response.json()) as Array<{
    handwritten_text: string;
    corrected_item_code: string;
    corrected_item_name: string;
    corrected_erp_qty: number;
    corrected_uom: string;
    extracted_item_code: string;
    extracted_erp_qty: number;
    extracted_uom: string;
  }>;

  const seen = new Set<string>();
  const examples: CorrectionExample[] = [];

  for (const row of rows) {
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
  }

  return examples;
}
