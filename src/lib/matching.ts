import type { ConvertedLine, ExtractedLine, ItemMasterRow } from "./types";

function normalize(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenOverlap(a: string, b: string) {
  const left = new Set(normalize(a).split(" ").filter(Boolean));
  const right = new Set(normalize(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;

  let matches = 0;
  left.forEach((token) => {
    if (right.has(token)) matches += 1;
  });

  return matches / Math.max(left.size, right.size);
}

function scoreLine(line: ExtractedLine, item: ItemMasterRow) {
  const source = normalize(`${line.itemHint} ${line.handwrittenText}`);
  const candidates = [item.itemCode, item.itemName, ...item.aliases];
  let best = 0;
  let bestReason = "";

  for (const candidate of candidates) {
    const normalizedCandidate = normalize(candidate);
    let score = tokenOverlap(source, normalizedCandidate) * 0.75;

    if (source.includes(normalizedCandidate) || normalizedCandidate.includes(source)) {
      score = Math.max(score, 0.92);
    }

    const codePrefix = normalizedCandidate.match(/[A-Z]*\d+[A-Z]*/)?.[0];
    if (codePrefix && source.includes(codePrefix)) {
      score = Math.max(score, 0.84);
    }

    if (score > best) {
      best = score;
      bestReason = candidate;
    }
  }

  return { score: Math.round(best * 100), reason: bestReason };
}

function normalizeOrderUnit(unit: string | undefined) {
  const value = normalize(unit || "");

  if (["CTN", "CARTON", "CARTONS", "CARTOON", "CARTOONS"].includes(value)) {
    return "Carton";
  }

  if (["BOX", "BOXS", "BOXES"].includes(value)) {
    return "Box";
  }

  if (["PE", "PC", "PCS", "PIECE", "PIECES", "NOS", "NO", "NUMBER", "NUMBERS"].includes(value)) {
    return "Nos";
  }

  return unit?.trim() || "Nos";
}

function getUomConversionFactor(item: ItemMasterRow | undefined, unit: string) {
  if (!item) {
    return { factor: 1, interpretedUnit: normalizeOrderUnit(unit) };
  }

  const interpretedUnit = normalizeOrderUnit(unit);
  const conversions = item.uomConversions || {};
  const matchedKey = Object.keys(conversions).find((key) => normalize(key) === normalize(interpretedUnit));

  if (matchedKey) {
    return { factor: conversions[matchedKey] || 1, interpretedUnit: matchedKey };
  }

  if (normalize(interpretedUnit) === normalize(item.defaultUom || "Nos")) {
    return { factor: 1, interpretedUnit };
  }

  return { factor: item.conversionQty || 1, interpretedUnit };
}

export function matchLines(lines: ExtractedLine[], itemMaster: ItemMasterRow[]): ConvertedLine[] {
  return lines.map((line) => {
    let bestItem: ItemMasterRow | undefined;
    let bestScore = 0;
    let bestReason = "";

    for (const item of itemMaster) {
      const result = scoreLine(line, item);
      if (result.score > bestScore) {
        bestItem = item;
        bestScore = result.score;
        bestReason = result.reason;
      }
    }

    const conversion = getUomConversionFactor(bestItem, line.unit);
    const erpQty = line.quantity * conversion.factor;
    const itemCode = bestItem?.itemCode || "";

    return {
      ...line,
      itemCode,
      itemName: bestItem?.itemName || "",
      erpQty,
      uom: bestItem?.defaultUom || line.unit || "Nos",
      confidence: bestScore,
      matchReason: bestReason
        ? `Matched with ${bestReason}; ${line.quantity} ${line.unit} interpreted as ${erpQty} ${
            bestItem?.defaultUom || "Nos"
          } using ${conversion.interpretedUnit} x ${conversion.factor}`
        : "No matching item found",
      needsReview: !itemCode || bestScore < 80
    };
  });
}
