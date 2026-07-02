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

type ErpNextItemSyncResult = {
  items: ItemMasterRow[];
  warning?: string;
  requiresCustomFieldSetup: boolean;
};

const standardItemFields = ["item_code", "item_name", "stock_uom"];
const customItemFields = [
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

function buildItemUrl(limitStart: number, fields: string[]) {
  const url = new URL(`${getErpNextBaseUrl()}/api/resource/Item`);
  url.searchParams.set("fields", JSON.stringify(fields));
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

function isMissingCustomFieldError(status: number, body: string) {
  return (
    status === 417 &&
    (body.includes("custom_sales_aliases") || body.includes("custom_quotation_conversion_qty")) &&
    body.includes("Field not permitted in query")
  );
}

async function fetchItemsWithFields(fields: string[]) {
  const apiKey = getRequiredEnv("ERPNEXT_API_KEY");
  const apiSecret = getRequiredEnv("ERPNEXT_API_SECRET");
  const items: ItemMasterRow[] = [];
  let limitStart = 0;

  while (true) {
    const response = await fetch(buildItemUrl(limitStart, fields), {
      headers: {
        Authorization: `token ${apiKey}:${apiSecret}`,
        Accept: "application/json"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      const body = await response.text();
      if (isMissingCustomFieldError(response.status, body)) {
        throw new Error("MISSING_ITEM_CUSTOM_FIELDS");
      }
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

export async function fetchErpNextItems(): Promise<ErpNextItemSyncResult> {
  try {
    return {
      items: await fetchItemsWithFields(customItemFields),
      requiresCustomFieldSetup: false
    };
  } catch (error) {
    if (error instanceof Error && error.message === "MISSING_ITEM_CUSTOM_FIELDS") {
      return {
        items: await fetchItemsWithFields(standardItemFields),
        warning:
          "ERPNext connection works, but Item custom fields are missing or not readable. Add custom_sales_aliases and custom_quotation_conversion_qty to enable alias matching and conversion qty.",
        requiresCustomFieldSetup: true
      };
    }

    throw error;
  }
}
