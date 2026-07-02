import type { ItemMasterRow } from "@/lib/types";

type ErpNextItem = {
  item_code: string;
  item_name?: string;
  stock_uom?: string;
  uoms?: Array<{
    uom?: string;
    conversion_factor?: number | string;
  }>;
};

type ErpNextListResponse = {
  data?: ErpNextItem[];
};

type ErpNextItemSyncResult = {
  items: ItemMasterRow[];
  warning?: string;
  requiresCustomFieldSetup: boolean;
};

export type ErpNextSyncProgress =
  | {
      type: "item-list";
      loaded: number;
      message: string;
    }
  | {
      type: "item-details";
      processed: number;
      total: number;
      failed: number;
      message: string;
    }
  | {
      type: "complete";
      count: number;
      warning?: string;
      message: string;
    };

type SyncProgressCallback = (progress: ErpNextSyncProgress) => void;

const standardItemFields = ["item_code", "item_name", "stock_uom"];
const itemDetailConcurrency = 4;

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function getErpNextBaseUrl() {
  return getRequiredEnv("ERPNEXT_BASE_URL").replace(/\/+$/, "");
}

function buildItemUrl(limitStart: number, fields: string[]) {
  const url = new URL(`${getErpNextBaseUrl()}/api/resource/Item`);
  url.searchParams.set("fields", JSON.stringify(fields));
  url.searchParams.set("filters", JSON.stringify([["disabled", "=", 0]]));
  url.searchParams.set("limit_start", String(limitStart));
  url.searchParams.set("limit_page_length", "500");
  return url;
}

function buildItemDetailUrl(itemCode: string) {
  return `${getErpNextBaseUrl()}/api/resource/Item/${encodeURIComponent(itemCode)}`;
}

function buildUomConversions(item: ErpNextItem) {
  const conversions: Record<string, number> = {};

  for (const row of item.uoms || []) {
    if (!row.uom) continue;
    const factor = Number(row.conversion_factor || 1) || 1;
    conversions[row.uom] = factor;
  }

  if (!Object.keys(conversions).length) {
    conversions[item.stock_uom || "Nos"] = 1;
  }

  return conversions;
}

function toItemMasterRow(item: ErpNextItem, detail?: ErpNextItem): ItemMasterRow {
  const source = detail || item;

  return {
    itemCode: item.item_code,
    itemName: item.item_name || item.item_code,
    aliases: [item.item_code],
    defaultUom: item.stock_uom || "Nos",
    conversionQty: 1,
    uomConversions: buildUomConversions(source)
  };
}

function getAuthHeaders() {
  const apiKey = getRequiredEnv("ERPNEXT_API_KEY");
  const apiSecret = getRequiredEnv("ERPNEXT_API_SECRET");

  return {
    Authorization: `token ${apiKey}:${apiSecret}`,
    Accept: "application/json"
  };
}

async function fetchItemDetail(itemCode: string): Promise<ErpNextItem | null> {
  try {
    const response = await fetch(buildItemDetailUrl(itemCode), {
      headers: getAuthHeaders(),
      cache: "no-store"
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { data?: ErpNextItem };
    return payload.data || null;
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

async function fetchItemsWithFields(fields: string[], onProgress?: SyncProgressCallback) {
  const items: ItemMasterRow[] = [];
  let limitStart = 0;

  while (true) {
    const response = await fetch(buildItemUrl(limitStart, fields), {
      headers: getAuthHeaders(),
      cache: "no-store"
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`ERPNext item sync failed: ${response.status} ${body.slice(0, 200)}`);
    }

    const payload = (await response.json()) as ErpNextListResponse;
    const page = payload.data || [];
    items.push(...page.map((item) => toItemMasterRow(item)));
    onProgress?.({
      type: "item-list",
      loaded: items.length,
      message: `${items.length} ERPNext items loaded`
    });

    if (page.length < 500) break;
    limitStart += page.length;
  }

  return items;
}

export async function fetchErpNextItems(onProgress?: SyncProgressCallback): Promise<ErpNextItemSyncResult> {
  const baseItems = await fetchItemsWithFields(standardItemFields, onProgress);
  let failedDetailCount = 0;
  let processedDetailCount = 0;

  const items = await mapWithConcurrency(baseItems, itemDetailConcurrency, async (item) => {
    const detail = await fetchItemDetail(item.itemCode);
    if (!detail) failedDetailCount += 1;
    processedDetailCount += 1;

    if (processedDetailCount === 1 || processedDetailCount % 50 === 0 || processedDetailCount === baseItems.length) {
      onProgress?.({
        type: "item-details",
        processed: processedDetailCount,
        total: baseItems.length,
        failed: failedDetailCount,
        message: `${processedDetailCount}/${baseItems.length} item UOM conversions loaded`
      });
    }

    return {
      ...item,
      uomConversions: detail ? buildUomConversions(detail) : item.uomConversions
    };
  });

  const warning = failedDetailCount
    ? `${failedDetailCount} ERPNext item details could not be loaded, so those rows may miss Box/Carton conversion factors.`
    : undefined;

  onProgress?.({
    type: "complete",
    count: items.length,
    warning,
    message: `${items.length} ERPNext items synced`
  });

  return {
    items,
    warning,
    requiresCustomFieldSetup: false
  };
}
