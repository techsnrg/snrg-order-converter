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

    const conversionQty = bestItem?.conversionQty || 1;
    const erpQty = line.quantity * conversionQty;
    const itemCode = bestItem?.itemCode || "";

    return {
      ...line,
      itemCode,
      itemName: bestItem?.itemName || "",
      erpQty,
      uom: bestItem?.defaultUom || line.unit || "Nos",
      confidence: bestScore,
      matchReason: bestReason ? `Matched with ${bestReason}` : "No matching item found",
      needsReview: !itemCode || bestScore < 80
    };
  });
}
