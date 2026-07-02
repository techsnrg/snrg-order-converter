import type { ItemMasterRow } from "@/lib/types";

type ErpNextItem = {
  item_code: string;
  item_name?: string;
  stock_uom?: string;
  custom_sales_aliases?: string;
  custom_quotation_conversion_qty?: number | string;
};

type ErpNextListResponse = {
  data?: ErpNextItem[];
};

const itemFields = [
  "item_code",
  "item_name",
  "stock_uom",
  "custom_sales_aliases",
  "custom_quotation_conversion_qty"
];

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function getErpNextBaseUrl() {
  return getRequiredEnv("ERPNEXT_BASE_URL").replace(/\/+$/, "");
}

function buildItemUrl(limitStart: number) {
  const url = new URL(`${getErpNextBaseUrl()}/api/resource/Item`);
  url.searchParams.set("fields", JSON.stringify(itemFields));
  url.searchParams.set("filters", JSON.stringify([["disabled", "=", 0]]));
  url.searchParams.set("limit_start", String(limitStart));
  url.searchParams.set("limit_page_length", "500");
  return url;
}

function splitAliases(value: string | undefined, itemCode: string) {
  const aliases = (value || "")
    .split(/[\n,|]+/)
    .map((alias) => alias.trim())
    .filter(Boolean);

  return Array.from(new Set([itemCode, ...aliases]));
}

function toItemMasterRow(item: ErpNextItem): ItemMasterRow {
  return {
    itemCode: item.item_code,
    itemName: item.item_name || item.item_code,
    aliases: splitAliases(item.custom_sales_aliases, item.item_code),
    defaultUom: item.stock_uom || "Nos",
    conversionQty: Number(item.custom_quotation_conversion_qty || 1) || 1
  };
}

export async function fetchErpNextItems(): Promise<ItemMasterRow[]> {
  const apiKey = getRequiredEnv("ERPNEXT_API_KEY");
  const apiSecret = getRequiredEnv("ERPNEXT_API_SECRET");
  const items: ItemMasterRow[] = [];
  let limitStart = 0;

  while (true) {
    const response = await fetch(buildItemUrl(limitStart), {
      headers: {
        Authorization: `token ${apiKey}:${apiSecret}`,
        Accept: "application/json"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`ERPNext item sync failed: ${response.status} ${body.slice(0, 200)}`);
    }

    const payload = (await response.json()) as ErpNextListResponse;
    const page = payload.data || [];
    items.push(...page.map(toItemMasterRow));

    if (page.length < 500) break;
    limitStart += page.length;
  }

  return items;
}
