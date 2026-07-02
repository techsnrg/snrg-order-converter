"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  Clipboard,
  Database,
  Download,
  FileImage,
  FileSpreadsheet,
  Loader2,
  RefreshCcw,
  Sparkles,
  UploadCloud
} from "lucide-react";
import { sampleItemMaster } from "@/data/sample-item-master";
import type { ConvertedLine, ItemMasterRow } from "@/lib/types";

type ApiResponse = {
  customerName: string;
  lines: ConvertedLine[];
  warning?: string;
  error?: string;
};

type ItemSyncResponse = {
  event?: "progress" | "result" | "error";
  type?: "item-list" | "item-details" | "complete";
  items?: ItemMasterRow[];
  count?: number;
  loaded?: number;
  processed?: number;
  total?: number;
  failed?: number;
  message?: string;
  syncedAt?: string;
  warning?: string;
  requiresCustomFieldSetup?: boolean;
  error?: string;
};

type CachedCatalogue = {
  itemMasterText: string;
  source: string;
  updatedAt: string;
};

type SharedCatalogueCacheResponse = {
  configured: boolean;
  cache?: {
    items: ItemMasterRow[];
    source: string;
    updatedAt: string;
  } | null;
  error?: string;
};

type CorrectionSaveResponse = {
  saved?: number;
  changed?: number;
  error?: string;
};

const emptyRows: ConvertedLine[] = [];
const catalogueHeaders = ["itemCode", "itemName", "aliases", "defaultUom", "conversionQty"];
const catalogueCacheKey = "snrg-order-converter:item-catalogue:v1";

function escapeCell(value: string | number) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function exportRows(rows: ConvertedLine[]) {
  const worksheetRows = rows.map((row, index) => ({
    idx: index + 1,
    item_code: row.itemCode,
    item_name: row.itemName,
    qty: row.erpQty,
    uom: row.uom,
    handwritten_text: row.handwrittenText,
    extracted_quantity: row.quantity,
    extracted_unit: row.unit,
    confidence: row.confidence,
    needs_review: row.needsReview ? "Yes" : "No",
    notes: row.notes || ""
  }));

  const headers = Object.keys(worksheetRows[0] || { item_code: "", qty: "" });
  const htmlRows = [
    `<tr>${headers.map((header) => `<th>${escapeCell(header)}</th>`).join("")}</tr>`,
    ...worksheetRows.map(
      (row) =>
        `<tr>${headers
          .map((header) => `<td>${escapeCell(row[header as keyof typeof row] ?? "")}</td>`)
          .join("")}</tr>`
    )
  ];
  const workbookHtml = `<!doctype html><html><head><meta charset="utf-8" /></head><body><table>${htmlRows.join(
    ""
  )}</table></body></html>`;
  const blob = new Blob([workbookHtml], {
    type: "application/vnd.ms-excel;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `quotation-items-${new Date().toISOString().slice(0, 10)}.xls`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let isQuoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      isQuoted = !isQuoted;
    } else if (char === "," && !isQuoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

function parseCatalogueCsv(value: string): ItemMasterRow[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));

    return {
      itemCode: row.itemCode,
      itemName: row.itemName,
      aliases: row.aliases
        .split("|")
        .map((alias) => alias.trim())
        .filter(Boolean),
      defaultUom: row.defaultUom || "Nos",
      conversionQty: Number(row.conversionQty || 1)
    };
  });
}

function downloadCatalogueTemplate() {
  const sampleRows = [
    catalogueHeaders.join(","),
    '"10105-WH","10105 WH","10105 VB|10105|10105-VB","Nos","300"',
    '"GCP006-010","GCP006 010","GCP006 010|GCP006-010|GCP006","Box","1"'
  ];
  const blob = new Blob([sampleRows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "item-catalogue-template.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseItemMasterText(value: string): ItemMasterRow[] {
  const parsed = JSON.parse(value) as ItemMasterRow[];
  return parsed.map((row) => ({
    ...row,
    aliases: Array.isArray(row.aliases) ? row.aliases : []
  }));
}

function getCatalogueStats(value: string) {
  try {
    const items = parseItemMasterText(value);
    const uomReady = items.filter((item) => item.uomConversions && Object.keys(item.uomConversions).length > 1).length;

    return {
      itemCount: items.length,
      uomReady
    };
  } catch {
    return {
      itemCount: 0,
      uomReady: 0
    };
  }
}

function formatTimeLabel(value: Date) {
  return value.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function saveCatalogueCache(cache: CachedCatalogue) {
  try {
    localStorage.setItem(catalogueCacheKey, JSON.stringify(cache));
  } catch {
    // The synced catalogue can still be used for the current session if browser storage is unavailable.
  }
}

async function saveSharedCatalogueCache(items: ItemMasterRow[], source: string) {
  const response = await fetch("/api/items/cache", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      items,
      source
    })
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Could not save shared item catalogue.");
  }
}

async function copyColumn(values: Array<string | number>) {
  const text = values.map((value) => String(value ?? "")).join("\n");
  await navigator.clipboard.writeText(text);
}

export default function Home() {
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [itemMasterText, setItemMasterText] = useState(JSON.stringify(sampleItemMaster, null, 2));
  const [rows, setRows] = useState<ConvertedLine[]>(emptyRows);
  const [originalRows, setOriginalRows] = useState<ConvertedLine[]>(emptyRows);
  const [customerName, setCustomerName] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isFinalized, setIsFinalized] = useState(false);
  const [isSyncingItems, setIsSyncingItems] = useState(false);
  const [syncProgress, setSyncProgress] = useState("");
  const [syncPercent, setSyncPercent] = useState(0);
  const [catalogueSource, setCatalogueSource] = useState("Sample");
  const [catalogueUpdatedAt, setCatalogueUpdatedAt] = useState("");

  const reviewCount = useMemo(() => rows.filter((row) => row.needsReview).length, [rows]);
  const catalogueStats = useMemo(() => getCatalogueStats(itemMasterText), [itemMasterText]);

  function restoreLocalCatalogueCache() {
    try {
      const cached = localStorage.getItem(catalogueCacheKey);
      if (!cached) return false;

      const parsed = JSON.parse(cached) as CachedCatalogue;
      parseItemMasterText(parsed.itemMasterText);
      setItemMasterText(parsed.itemMasterText);
      setCatalogueSource(parsed.source || "Saved");
      setCatalogueUpdatedAt(parsed.updatedAt || "");
      return true;
    } catch {
      localStorage.removeItem(catalogueCacheKey);
      return false;
    }
  }

  useEffect(() => {
    async function loadSharedCatalogueCache() {
      try {
        const response = await fetch("/api/items/cache");
        const data = (await response.json()) as SharedCatalogueCacheResponse;

        if (response.ok && data.cache?.items?.length) {
          const itemMaster = JSON.stringify(data.cache.items, null, 2);
          const updatedAt = formatTimeLabel(new Date(data.cache.updatedAt));
          setItemMasterText(itemMaster);
          setCatalogueSource(data.cache.source || "Shared");
          setCatalogueUpdatedAt(updatedAt);
          saveCatalogueCache({
            itemMasterText: itemMaster,
            source: data.cache.source || "Shared",
            updatedAt
          });
          return;
        }
      } catch {
        // Fall back to browser cache when the shared cache is unavailable.
      }

      restoreLocalCatalogueCache();
    }

    loadSharedCatalogueCache();
  }, []);

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setImage(file);
    setRows(emptyRows);
    setOriginalRows(emptyRows);
    setIsFinalized(false);
    setMessage("");
    setPreviewUrl(file ? URL.createObjectURL(file) : "");
  }

  async function handleCatalogueUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const catalogue = parseCatalogueCsv(text);
      if (!catalogue.length) {
        setMessage("Catalogue CSV has no item rows.");
        return;
      }
      const nextItemMasterText = JSON.stringify(catalogue, null, 2);
      const updatedAt = formatTimeLabel(new Date());
      setItemMasterText(nextItemMasterText);
      setCatalogueSource(file.name);
      setCatalogueUpdatedAt(updatedAt);
      saveCatalogueCache({
        itemMasterText: nextItemMasterText,
        source: file.name,
        updatedAt
      });
      try {
        await saveSharedCatalogueCache(catalogue, file.name);
        setMessage(`${catalogue.length} catalogue items loaded from ${file.name} and saved to Supabase.`);
      } catch (error) {
        setMessage(
          `${catalogue.length} catalogue items loaded locally. ${
            error instanceof Error ? error.message : "Could not save shared item catalogue."
          }`
        );
      }
    } catch {
      setMessage("Could not read catalogue CSV.");
    } finally {
      event.target.value = "";
    }
  }

  async function syncErpNextCatalogue() {
    setIsSyncingItems(true);
    setSyncProgress("Starting ERPNext sync...");
    setSyncPercent(2);
    setMessage("");

    try {
      const response = await fetch("/api/items/sync");
      if (!response.ok || !response.body) throw new Error("Could not sync ERPNext items.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const data = JSON.parse(line) as ItemSyncResponse;

          if (data.event === "error") throw new Error(data.error || "Could not sync ERPNext items.");

          if (data.event === "progress") {
            setSyncProgress(data.message || "Syncing ERPNext items...");
            if (data.type === "item-list") {
              setSyncPercent(10);
            } else if (data.type === "item-details" && data.total) {
              setSyncPercent(10 + Math.round(((data.processed || 0) / data.total) * 85));
            } else if (data.type === "complete") {
              setSyncPercent(98);
            }
          }

          if (data.event === "result") {
            const nextItemMasterText = JSON.stringify(data.items || [], null, 2);
            const updatedAt = formatTimeLabel(new Date());
            setItemMasterText(nextItemMasterText);
            setCatalogueSource("ERPNext");
            setCatalogueUpdatedAt(updatedAt);
            saveCatalogueCache({
              itemMasterText: nextItemMasterText,
              source: "ERPNext",
              updatedAt
            });
            setSyncProgress(data.warning || `${data.count || 0} active ERPNext items synced.`);
            setSyncPercent(100);
            setMessage(data.warning || `${data.count || 0} active ERPNext items synced.`);
          }
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sync ERPNext items.");
      setSyncProgress("");
      setSyncPercent(0);
    } finally {
      setIsSyncingItems(false);
    }
  }

  function updateRow(index: number, patch: Partial<ConvertedLine>) {
    setIsFinalized(false);
    setRows((currentRows) =>
      currentRows.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              ...patch,
              needsReview: patch.needsReview ?? false
            }
          : row
      )
    );
  }

  async function finalizeRows() {
    if (!rows.length) {
      setMessage("Convert an order before finalizing.");
      return;
    }

    setIsFinalizing(true);
    setMessage("");

    try {
      const response = await fetch("/api/corrections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          customerName,
          imageName: image?.name || "",
          originalRows,
          correctedRows: rows
        })
      });
      const data = (await response.json()) as CorrectionSaveResponse;

      if (!response.ok) throw new Error(data.error || "Could not save correction history.");

      setIsFinalized(true);
      setMessage(`Finalized ${data.saved || rows.length} rows. ${data.changed || 0} corrections saved for learning.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save correction history.");
    } finally {
      setIsFinalizing(false);
    }
  }

  async function copyItemCodes() {
    await copyColumn(rows.map((row) => row.itemCode));
    setMessage(`${rows.length} item codes copied. Paste into ERPNext Item Code column.`);
  }

  async function copyQuantities() {
    await copyColumn(rows.map((row) => row.erpQty));
    setMessage(`${rows.length} quantities copied. Paste into ERPNext Qty column.`);
  }

  async function convertOrder() {
    if (!image) {
      setMessage("Please upload an order image first.");
      return;
    }

    let itemMaster: ItemMasterRow[];
    try {
      itemMaster = parseItemMasterText(itemMasterText);
    } catch {
      setMessage("Item master JSON is not valid.");
      return;
    }

    setIsLoading(true);
    setMessage("");

    const formData = new FormData();
    formData.append("image", image);
    formData.append("itemMaster", JSON.stringify(itemMaster));

    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        body: formData
      });

      const data = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(data.error || "Could not convert the order.");

      const nextRows = data.lines || [];
      setRows(nextRows);
      setOriginalRows(nextRows.map((row) => ({ ...row })));
      setIsFinalized(false);
      setCustomerName(data.customerName || "");
      setMessage(data.warning || "Order converted. Review highlighted rows before exporting.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not convert the order.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">SNRG internal tool</p>
          <h1>Order Converter</h1>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setRows(emptyRows);
            setOriginalRows(emptyRows);
            setIsFinalized(false);
          }}
        >
          <RefreshCcw size={16} />
          Reset
        </button>
      </section>

      <section className="workspace">
        <div className="panel upload-panel">
          <div className="panel-title">
            <FileImage size={18} />
            <h2>Order photo</h2>
          </div>

          <label className="dropzone">
            <UploadCloud size={28} />
            <span>{image ? image.name : "Upload WhatsApp order image"}</span>
            <input accept="image/*" type="file" onChange={handleImageChange} />
          </label>

          {previewUrl ? <img className="preview" src={previewUrl} alt="Uploaded sales order" /> : null}

          <button className="primary-button" type="button" onClick={convertOrder} disabled={isLoading}>
            {isLoading ? <Loader2 className="spin" size={16} /> : <UploadCloud size={16} />}
            Convert
          </button>
        </div>

        <div className="panel catalogue-panel">
          <div className="panel-title panel-title-split">
            <div>
              <p className="eyebrow">Catalogue</p>
              <h2>ERPNext items</h2>
            </div>
            <Database size={22} />
          </div>

          <div className="catalogue-metrics">
            <div className="metric">
              <span>Items</span>
              <strong>{catalogueStats.itemCount.toLocaleString("en-IN")}</strong>
            </div>
            <div className="metric">
              <span>UOM factors</span>
              <strong>{catalogueStats.uomReady.toLocaleString("en-IN")}</strong>
            </div>
            <div className="metric">
              <span>Source</span>
              <strong>{catalogueSource}</strong>
            </div>
          </div>

          <div className="catalogue-actions">
            <button className="secondary-button" type="button" onClick={syncErpNextCatalogue} disabled={isSyncingItems}>
              {isSyncingItems ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
              Sync ERPNext
            </button>
            <label className="secondary-button file-button">
              <UploadCloud size={16} />
              Upload CSV
              <input accept=".csv,text/csv" type="file" onChange={handleCatalogueUpload} />
            </label>
            <button className="secondary-button" type="button" onClick={downloadCatalogueTemplate}>
              <Download size={16} />
              Template
            </button>
          </div>

          {syncProgress ? (
            <div className="sync-progress">
              <div className="sync-progress-head">
                <span>{syncProgress}</span>
                <span>{syncPercent}%</span>
              </div>
              <div className="sync-progress-track">
                <div className="sync-progress-bar" style={{ width: `${syncPercent}%` }} />
              </div>
            </div>
          ) : null}

          <div className="catalogue-foot">
            <FileSpreadsheet size={16} />
            <span>{catalogueUpdatedAt ? `Updated ${catalogueUpdatedAt}` : "Ready for sync"}</span>
          </div>
        </div>
      </section>

      {message ? <section className="status-band">{message}</section> : null}

      <section className="results">
        <div className="results-head">
          <div>
            <p className="eyebrow">{customerName || "Quotation item rows"}</p>
            <h2>{rows.length} rows extracted</h2>
          </div>
          <div className="actions">
            <span className={reviewCount ? "pill warn" : "pill"}>{reviewCount} need review</span>
            <button className="secondary-button" type="button" disabled={!rows.length || isFinalizing} onClick={finalizeRows}>
              {isFinalizing ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
              Finalize & Learn
            </button>
            <button className="secondary-button" type="button" disabled={!isFinalized} onClick={copyItemCodes}>
              <Clipboard size={16} />
              Copy Item Codes
            </button>
            <button className="secondary-button" type="button" disabled={!isFinalized} onClick={copyQuantities}>
              <Clipboard size={16} />
              Copy Qty
            </button>
            <button className="primary-button" type="button" disabled={!rows.length} onClick={() => exportRows(rows)}>
              <Download size={16} />
              Export Excel
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Handwritten</th>
                <th>Item code</th>
                <th>Item name</th>
                <th>ERP qty</th>
                <th>UOM</th>
                <th>Confidence</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row, index) => (
                  <tr key={`${row.handwrittenText}-${index}`} className={row.needsReview ? "review-row" : ""}>
                    <td>{row.handwrittenText}</td>
                    <td>
                      <input value={row.itemCode} onChange={(event) => updateRow(index, { itemCode: event.target.value })} />
                    </td>
                    <td>
                      <input value={row.itemName} onChange={(event) => updateRow(index, { itemName: event.target.value })} />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={row.erpQty}
                        onChange={(event) => updateRow(index, { erpQty: Number(event.target.value) })}
                      />
                    </td>
                    <td>
                      <input value={row.uom} onChange={(event) => updateRow(index, { uom: event.target.value })} />
                    </td>
                    <td>{row.confidence}%</td>
                    <td>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={row.needsReview}
                          onChange={(event) => updateRow(index, { needsReview: event.target.checked })}
                        />
                        Check
                      </label>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="empty">
                    Upload a handwritten order image to generate ERPNext-ready rows.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
