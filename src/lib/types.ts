export type ExtractedLine = {
  handwrittenText: string;
  itemHint: string;
  quantity: number;
  unit: string;
  notes?: string;
};

export type ItemMasterRow = {
  itemCode: string;
  itemName: string;
  aliases: string[];
  defaultUom?: string;
  conversionQty?: number;
  uomConversions?: Record<string, number>;
};

export type ConvertedLine = ExtractedLine & {
  itemCode: string;
  itemName: string;
  erpQty: number;
  uom: string;
  confidence: number;
  matchReason: string;
  needsReview: boolean;
};
