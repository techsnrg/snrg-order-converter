import type { ItemMasterRow } from "@/lib/types";
import { isUpstashConfigured, upstashCommand } from "./client";

export type CatalogueCache = {
  items: ItemMasterRow[];
  source: string;
  itemCount: number;
  uomReadyCount: number;
  syncedAt: string;
  updatedAt: string;
};

const catalogueCacheKey = "order_converter:item_catalogue";

function getStats(items: ItemMasterRow[]) {
  return {
    itemCount: items.length,
    uomReadyCount: items.filter((item) => item.uomConversions && Object.keys(item.uomConversions).length > 1).length
  };
}

export function isCatalogueCacheConfigured() {
  return isUpstashConfigured();
}

export async function readCatalogueCache(): Promise<CatalogueCache | null> {
  const result = await upstashCommand<string>(["GET", catalogueCacheKey]);
  if (!result) return null;

  return JSON.parse(result) as CatalogueCache;
}

export async function writeCatalogueCache(items: ItemMasterRow[], source: string) {
  if (!isUpstashConfigured()) return null;

  const now = new Date().toISOString();
  const stats = getStats(items);
  const cache: CatalogueCache = {
    items,
    source,
    itemCount: stats.itemCount,
    uomReadyCount: stats.uomReadyCount,
    syncedAt: now,
    updatedAt: now
  };

  await upstashCommand<string>(["SET", catalogueCacheKey, JSON.stringify(cache)]);

  return cache;
}
