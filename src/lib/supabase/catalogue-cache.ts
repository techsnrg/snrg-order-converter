import type { ItemMasterRow } from "@/lib/types";

export type CatalogueCache = {
  items: ItemMasterRow[];
  source: string;
  itemCount: number;
  uomReadyCount: number;
  syncedAt: string;
  updatedAt: string;
};

const catalogueCacheKey = "item_catalogue";
const tableName = "order_converter_cache";

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) return null;

  return {
    url,
    serviceRoleKey
  };
}

function getHeaders(serviceRoleKey: string) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json"
  };
}

function getStats(items: ItemMasterRow[]) {
  return {
    itemCount: items.length,
    uomReadyCount: items.filter((item) => item.uomConversions && Object.keys(item.uomConversions).length > 1).length
  };
}

export function isCatalogueCacheConfigured() {
  return Boolean(getSupabaseConfig());
}

export async function readCatalogueCache(): Promise<CatalogueCache | null> {
  const config = getSupabaseConfig();
  if (!config) return null;

  const response = await fetch(
    `${config.url}/rest/v1/${tableName}?cache_key=eq.${catalogueCacheKey}&select=data,source,item_count,uom_ready_count,synced_at,updated_at`,
    {
      headers: getHeaders(config.serviceRoleKey),
      cache: "no-store"
    }
  );

  if (!response.ok) {
    throw new Error(`Could not read Supabase catalogue cache: ${response.status}`);
  }

  const rows = (await response.json()) as Array<{
    data: ItemMasterRow[];
    source: string;
    item_count: number;
    uom_ready_count: number;
    synced_at: string;
    updated_at: string;
  }>;
  const row = rows[0];

  if (!row) return null;

  return {
    items: row.data,
    source: row.source,
    itemCount: row.item_count,
    uomReadyCount: row.uom_ready_count,
    syncedAt: row.synced_at,
    updatedAt: row.updated_at
  };
}

export async function writeCatalogueCache(items: ItemMasterRow[], source: string) {
  const config = getSupabaseConfig();
  if (!config) return null;

  const now = new Date().toISOString();
  const stats = getStats(items);
  const response = await fetch(`${config.url}/rest/v1/${tableName}`, {
    method: "POST",
    headers: {
      ...getHeaders(config.serviceRoleKey),
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify({
      cache_key: catalogueCacheKey,
      data: items,
      source,
      item_count: stats.itemCount,
      uom_ready_count: stats.uomReadyCount,
      synced_at: now,
      updated_at: now
    })
  });

  if (!response.ok) {
    throw new Error(`Could not write Supabase catalogue cache: ${response.status}`);
  }

  return {
    items,
    source,
    itemCount: stats.itemCount,
    uomReadyCount: stats.uomReadyCount,
    syncedAt: now,
    updatedAt: now
  };
}
